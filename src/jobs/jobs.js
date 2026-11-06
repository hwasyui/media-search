// Runner simulasi/cron + job manager. Dipakai bersama oleh server (tombol di web, jalan di background)
// dan scripts/*.js (CLI). Runner tidak mencetak ke console sendiri: semua keluaran lewat ctx.
//
//   ctx = { signal, log(msg), progress({stage, done, total, ...}), onReport(report) }
import { randomUUID } from 'node:crypto';
import { cleanItems } from '../news/clean.js';
import { enrichItemsWithContent, htmlToText } from '../content/extractor.js';
import { isGoogleArticle, resolveGoogleUrl } from '../links/gnews.js';
import { isGoogleNewsUrl, resolveArticleUrl } from '../links/resolver.js';
import { findPublisherUrl, isSearchUrl, isUsableArticleUrl } from '../links/links.js';
import { getFinancials } from '../risk/financial.js';
import { markJobsInterrupted, saveAnalysis, saveFinancial, saveJobRun, saveNews, saveReport, saveRiskProfile } from '../db/save.js';
import { getRiskProfile } from '../risk/riskprofile.js';
import { generateAnalysis } from '../ai/analysis.js';
import { INCOMPLETE_SQL, splitComplete } from '../news/news.js';
import { buildMatcher, normTitle } from '../news/related.js';
import { createHash } from 'node:crypto';
import { contentKind, platformOf } from '../news/kind.js';
import { enrichContentHtml, realUrl } from '../content/content.js';
import { generateCompanyDossier, getCompanyDossier } from '../ai/dossier.js';
import { latestAnalysis, listCompanies, listJobRuns } from '../db/store.js';
import { db } from '../db/db.js';
import { BATCH, aiUsage, classifyItems, geminiKeys, groqKeys, MAX_ITEMS } from '../ai/classify.js';
import {
  buildJobs, estimateChunkMs, healthFlags, makeFakeRunner, resolveTargets, runJobs,
  summarizeAi, summarizeClean, summarizeFetch, summarizeRawQuality,
} from './sim-lib.js';

// Siapkan isi artikel untuk item hasil crawl sebelum disimpan. Urutannya sengaja begini:
//  1) item yang sudah tersimpan lengkap (sudah punya isi) dilewati, jadi tidak diunduh ulang di tiap crawl;
//  2) tautan Google News diselesaikan SATU PER SATU lewat gnews.js (yang pernah diselesaikan dipakai ulang dari DB) agar tidak kena 429;
//  3) ekstraktor (tidak diubah) membaca alamat penerbit. Item yang tautannya belum bisa diselesaikan tidak diekstrak (isinya menyusul lewat "Lengkapi data tersimpan").
// it.url dikembalikan ke tautan awal setelahnya (kunci duplikat tetap sama); alamat penerbit disimpan terpisah di it.articleUrl.
async function prepareContent(companyId, items, { concurrency = 6, signal, log = () => {}, onProgress } = {}) {
  if (!items.length) return items;
  const keyOf = (it) => createHash('sha1').update(it.canonical || it.url).digest();
  const known = new Map();
  if (companyId) {
    for (let i = 0; i < items.length; i += 500) {
      const [rows] = await db().query('SELECT HEX(url_hash) h, article_url, content_html IS NOT NULL AS has FROM news_items WHERE company_id = ? AND url_hash IN (?)', [companyId, items.slice(i, i + 500).map(keyOf)]);
      rows.forEach((r) => known.set(r.h, r));
    }
  }
  const todo = [], toResolve = [];
  let skipped = 0;
  for (const it of items) {
    const k = known.get(keyOf(it).toString('hex').toUpperCase());
    const google = isGoogleNewsUrl(it.url) || isSearchUrl(it.url);      // tautan pencarian Google (pengganti dari resolver) juga dianggap BELUM terselesaikan
    if (k?.has && (k.article_url || !google)) {
      if (k.article_url) { it.articleUrl = k.article_url; it.url = k.article_url; }
      skipped++;
      continue;
    }
    if (google && k?.article_url) {
      it.url = k.article_url;
      it.articleUrl = k.article_url;
      todo.push(it);
    } else if (google) {
      toResolve.push(it);
    } else {
      todo.push(it);
    }
  }
  let ok = 0, fail = 0;
  for (const it of toResolve) {
    if (signal?.aborted) break;
    const real = await findPublisherUrl({ masked: it.originalUrl || it.url, title: it.title, source_domain: it.sourceDomain, source_name: it.sourceName, signal }).catch(() => null);
    if (real) {
      it.url = real;
      it.articleUrl = real;
      todo.push(it);
      ok++;
    } else {
      fail++;
      it.linkError = 'decode_gagal';
    }
  }
  log(`tautan Google News: ${ok} diselesaikan${fail ? `, ${fail} belum` : ''}; ${skipped} item sudah lengkap dan dilewati`);
  // Artikel yang sama (alamat penerbit sama) sudah diambil untuk perusahaan lain: salin isi dan gambarnya dari sana, jangan unduh ulang.
  const fetchList = [];
  let copied = 0;
  const urlsOf = [...new Set(todo.map((it) => it.articleUrl || it.url).filter(Boolean))];
  const sib = new Map();
  for (let i = 0; i < urlsOf.length; i += 300) {
    const [rows] = await db().query('SELECT article_url, content_html, image_url FROM news_items WHERE article_url IN (?) AND content_html IS NOT NULL AND CHAR_LENGTH(content_html) >= 300 ORDER BY CHAR_LENGTH(content_html) DESC', [urlsOf.slice(i, i + 300)]);
    for (const r of rows) if (!sib.has(r.article_url)) sib.set(r.article_url, r);
  }
  for (const it of todo) {
    const s = sib.get(it.articleUrl || it.url);
    if (s) { it.contentHtml = s.content_html; it.fullContent = htmlToText(s.content_html); if (!it.image && s.image_url) it.image = s.image_url; copied++; } else fetchList.push(it);
  }
  if (copied) log(`${copied} artikel yang sama sudah diambil untuk perusahaan lain: isinya disalin (tidak diunduh ulang)`);
  await enrichItemsWithContent(fetchList, { concurrency, onProgress });
  return items;
}

const MAX_REAL_JOBS = 1000;    // pengaman: satu run nyata maksimal 1000 query

const num = (v, d) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Analisis AI dan dossier dibuat ulang MINGGUAN (bawaan 7 hari; opts.analysisEveryDays), bukan tiap crawl: teks buatan AI bisa berbeda tiap kali dibuat,
// jadi yang sudah ada dipertahankan sampai cukup tua. Berita baru tidak memicu pembuatan ulang. opts.forceAnalysis = true mengabaikan jadwal.
// Tombol "Analisis AI" dan "Dossier" di Task Runner selalu membuat ulang (langkah satuan, dipicu manual).
const REFRESH_DAYS = 7;
const ageDays = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 864e5 : Infinity);
const everyDaysOf = (opts) => clamp(num(opts.analysisEveryDays, REFRESH_DAYS), 0, 365);
// Umur (hari) hasil terakhir bila MASIH segar menurut jadwal; null bila perlu dibuat ulang (belum ada, format lama, sudah tua, atau dipaksa).
async function freshAnalysisAge(coId, opts) {
  if (opts.forceAnalysis) return null;
  const a = await latestAnalysis(coId).catch(() => null);
  const age = a?.verifikasi ? ageDays(a.generatedAt) : Infinity;
  return age < everyDaysOf(opts) ? age : null;
}
async function freshDossierAge(coId, opts) {
  if (opts.forceAnalysis) return null;
  const d = await getCompanyDossier(coId).catch(() => null);
  const age = ageDays(d?.generated_at);
  return age < everyDaysOf(opts) ? age : null;
}
const umurTxt = (age) => (age < 1 ? 'hari ini' : Math.floor(age) + ' hari lalu');

function cancelled() {
  return Object.assign(new Error('Dibatalkan'), { code: 'CANCELLED' });
}
const throwIfAborted = (signal) => { if (signal?.aborted) throw cancelled(); };

function sleepAbortable(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

// ─── Penyimpanan ke DB ─────────────────────────────────
// Simpan semua hasil clean ke news_items (yang sudah diklasifikasi menimpa versi mentahnya). Dry run tidak menyimpan.
async function persistItems(entity, cleanedItems, classified, report, log) {
  if (!entity?.id) { log('berita tidak disimpan ke DB: run memakai keyword manual (tanpa --company).'); return; }
  const byUrl = new Map((classified || []).map((it) => [it.url, it]));
  const items = cleanedItems.map((it) => byUrl.get(it.url) || it);
  report.saved = await saveNews(entity.id, items);
  const s = report.saved, lama = Math.max(0, s.saved - s.inserted);
  log(`DB: ${items.length} berita masuk → ${s.inserted} baru disimpan, ${lama} sudah ada di database (hanya diperbarui)${s.duplicates ? `, ${s.duplicates} duplikat judul dibuang` : ''}${s.replaced ? `, ${s.replaced} diganti versi penerbit lebih kredibel` : ''}`);
  return new Set(report.saved.droppedUrls || []);
}

// ─── Cron: splitter + berurutan + jeda ─────────────────
// opts: { company | keywords, sources, modifiers, chunkSize, delayMs, concurrency, classify, aiChunk, aiDelayMs,
//         dry, fakeJobs, everyMin, maxCycles, maxAgeDays }
export async function runCron(opts = {}, ctx = {}) {
  const log = ctx.log || (() => {});
  const progress = ctx.progress || (() => {});
  const targets = await resolveTargets(opts);
  const everyMs = clamp(num(opts.everyMin, 0), 0, 24 * 60) * 60_000;
  const maxCycles = everyMs ? clamp(num(opts.maxCycles, 1_000_000), 1, 1_000_000) : 1;
  const reports = [];

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    throwIfAborted(ctx.signal);
    try {
      const report = await runCronCycle(opts, targets, cycle, ctx);
      reports.push(report);
    } catch (e) {
      if (e.code === 'CANCELLED') throw e;
      log(`cycle ${cycle} gagal: ${e.message}`);          // satu siklus gagal tidak mematikan cron
      if (!everyMs) throw e;
    }
    if (!everyMs || cycle >= maxCycles) break;
    const nextRunAt = Date.now() + everyMs;
    log(`menunggu ${opts.everyMin} menit sebelum cycle ${cycle + 1}`);
    progress({ stage: 'waiting', cycle, nextRunAt, done: 0, total: 0 });
    await sleepAbortable(everyMs, ctx.signal);
  }
  return reports;
}

async function runCronCycle(opts, targets, cycle, ctx) {
  const log = ctx.log || (() => {});
  const progress = ctx.progress || (() => {});
  const concurrency = clamp(num(opts.concurrency, 3), 1, 6);
  const chunkSize = clamp(num(opts.chunkSize, 6), 1, 100);
  const delayMs = clamp(num(opts.delayMs, 15000), 0, 600_000);
  const aiChunk = clamp(num(opts.aiChunk, 60), 1, 500);
  const aiDelayMs = clamp(num(opts.aiDelayMs, 3000), 0, 600_000);
  const dry = Boolean(opts.dry);

  let jobs = buildJobs(targets.keywords, targets.sources, targets.modifiers, targets.anchors, targets.extraQueries);
  if (dry && opts.fakeJobs) {
    // Perbanyak job (keyword sintetis) untuk mensimulasikan volume besar
    const base = jobs;
    const target = clamp(num(opts.fakeJobs, base.length), 1, 5000);
    jobs = Array.from({ length: target }, (_, i) => {
      const b = base[i % base.length];
      return { ...b, keyword: i >= base.length ? `${b.keyword} #${Math.floor(i / base.length)}` : b.keyword };
    });
  }
  if (!dry && jobs.length > MAX_REAL_JOBS) throw new Error(`Terlalu banyak query (${jobs.length}); maksimal ${MAX_REAL_JOBS} untuk run nyata.`);

  const chunks = [];
  for (let i = 0; i < jobs.length; i += chunkSize) chunks.push(jobs.slice(i, i + chunkSize));
  const run = dry ? makeFakeRunner() : runJobs;
  log(`cycle ${cycle}: ${jobs.length} job -> ${chunks.length} work x ${chunkSize} job, jeda ${delayMs}ms${dry ? ' (DRY)' : ''}`);

  // Rencana crawl yang bisa dilihat di Task Runner: tiap work berisi daftar query (sumber, modifier, teks query) beserta statusnya.
  const planWorks = chunks.map((c, i) => ({ n: i + 1, state: 'menunggu', jobs: c.map((j) => ({ s: j.source, m: j.modifier, k: j.keyword, q: String(j.q).slice(0, 170) })) }));
  const plan = { company: targets.entity?.name || '', cycle, total: jobs.length, chunkSize, delayMs, concurrency, works: planWorks };
  progress({ plan });
  const allResults = [];
  const perWork = [];
  let projectedMs = 0;
  const wallStart = Date.now();

  for (let i = 0; i < chunks.length; i++) {
    throwIfAborted(ctx.signal);
    const label = `work${i + 1}`;
    planWorks[i].state = 'berjalan';
    progress({ stage: 'crawl', cycle, work: label, done: i, total: chunks.length, plan });
    const t0 = Date.now();
    const results = await run(chunks[i], { concurrency, signal: ctx.signal });
    throwIfAborted(ctx.signal);
    const ms = dry ? estimateChunkMs(results, concurrency) : Date.now() - t0;
    allResults.push(...results);
    const failed = results.filter((r) => !r.ok).length;
    const items = results.reduce((s, r) => s + r.items.length, 0);
    perWork.push({ work: label, jobs: chunks[i].length, items, failed, ms });
    projectedMs += ms;
    log(`${label}/${chunks.length}: ${items} item, ${failed} gagal, ${ms}ms`);
    const w = planWorks[i];
    w.state = failed && failed === chunks[i].length ? 'gagal' : 'selesai'; w.items = items; w.failed = failed; w.ms = ms;
    for (const r of results) {
      const jj = w.jobs.find((x) => x.s === r.job.source && x.q === String(r.job.q).slice(0, 170));
      if (jj) { jj.n = r.items.length; if (!r.ok) jj.e = String(r.error || 'gagal').slice(0, 90); }
    }
    progress({ stage: 'crawl', cycle, work: label, done: i + 1, total: chunks.length, plan });
    if (i < chunks.length - 1) {
      projectedMs += delayMs;
      if (!dry && delayMs) {
        log(`jeda ${delayMs}ms sebelum work${i + 2}`);
        await sleepAbortable(delayMs, ctx.signal);
      }
    }
  }

  const rawItems = allResults.flatMap((r) => r.items);
  progress({ stage: 'clean', cycle, done: 0, total: 1 });
  const cleaned = cleanItems(rawItems);              // dedup setelah semua work selesai, jadi lintas chunk
  const cs = cleaned.stats, buang = [cs.invalid && `${cs.invalid} tidak valid`, cs.spam && `${cs.spam} spam`, cs.duplicate && `${cs.duplicate} duplikat dalam crawl ini`].filter(Boolean).join(', ');
  log(`clean: ${cs.output}/${cs.input} lolos${buang ? ` (dibuang: ${buang})` : ''}`);

  const report = {
    type: 'cron',
    createdAt: new Date().toISOString(),
    cycle,
    config: { keywords: targets.keywords.length, sources: targets.sources, jobs: jobs.length, works: chunks.length, chunkSize, delayMs, concurrency, dry },
    perWork,
    fetch: summarizeFetch(allResults),
    raw: summarizeRawQuality(rawItems, clamp(num(opts.maxAgeDays, 7), 1, 60)),
    clean: summarizeClean(cleaned.stats),
  };

  if (!dry && cleaned.items.length) {
    log(`ekstraksi konten: mengambil isi artikel & caption sosmed (${cleaned.items.length} item)...`);
    await prepareContent(targets.entity?.id, cleaned.items, { concurrency: 6, signal: ctx.signal, log, onProgress: (d, tot) => progress({ stage: 'extract', cycle, done: d, total: tot }) });
    // Berita yang alamat penerbitnya belum ditemukan TETAP disimpan ke data mentah (hash alamat awal mencegah duplikat; diselesaikan lagi di crawl berikutnya atau lewat
    // "Lengkapi data tersimpan"). Mereka tersembunyi dari data cleaned oleh view dan TIDAK dikirim ke AI sampai alamat penerbitnya ketemu.
    const noPub = cleaned.items.filter((it) => !it.articleUrl && !isUsableArticleUrl(it.url)).length;
    if (noPub) log(`${noPub} berita disimpan sebagai data mentah tanpa alamat penerbit (belum cleaned, belum dikirim ke AI)`);
    log(`ekstraksi selesai: konten lengkap & caption siap`);
  }

  const droppedDup = !dry ? await persistItems(targets.entity, cleaned.items, null, report, log) : new Set();     // berita langsung tersimpan sebelum AI jalan

  const sp = !dry && targets.entity?.id ? await splitComplete(targets.entity.id, cleaned.items.filter((it) => !droppedDup.has(it.url))) : { todo: cleaned.items, complete: [] };
  if (sp.complete.length) { log(`${sp.complete.length} berita sudah terklasifikasi lengkap: dilewati (tidak dikirim ke AI)`); report.aiSkippedComplete = sp.complete.length; }
  const aiItems = sp.todo.filter((it) => it.articleUrl || isUsableArticleUrl(it.url)).slice(0, MAX_ITEMS);      // AI hanya untuk berita yang alamat penerbitnya sudah ketemu
  const keys = groqKeys().length;
  const aiCalls = Math.ceil(aiItems.length / BATCH);
  if (opts.classify && !dry) {
    const classified = [];
    for (let i = 0; i < aiItems.length; i += aiChunk) {
      throwIfAborted(ctx.signal);
      const label = `ai-work${Math.floor(i / aiChunk) + 1}/${Math.ceil(aiItems.length / aiChunk)}`;
      progress({ stage: 'ai', cycle, work: label, done: i, total: aiItems.length });
      const t0 = Date.now();
      const u0 = { ...aiUsage };
      const out = await classifyItems(aiItems.slice(i, i + aiChunk), targets.entity);
      classified.push(...out);
      if (targets.entity?.id) await saveNews(targets.entity.id, out, { dedupe: false });      // perbarui per batch AI
      const bad = out.filter((o) => o.ai?.error).length;
      const via = [aiUsage.groq - u0.groq && 'Groq ' + (aiUsage.groq - u0.groq) + ' call', aiUsage.gemini - u0.gemini && 'Gemini ' + (aiUsage.gemini - u0.gemini) + ' call'].filter(Boolean).join(', ') || 'tidak ada AI yang menjawab';
      log(`${label}: ${Math.min(aiChunk, aiItems.length - i)} item, ${Date.now() - t0}ms · ${via}${bad ? ` · ${bad} GAGAL (${out.find((o) => o.ai?.error).ai.error.slice(0, 90)})` : ''}`);
      if (i + aiChunk < aiItems.length) await sleepAbortable(aiDelayMs, ctx.signal);
    }
    report.ai = summarizeAi(classified);
  } else {
    // Proyeksi tanpa memanggil Groq: jumlah call dan perkiraan beban per key
    const aiChunks = Math.ceil(aiItems.length / aiChunk);
    const aiMs = aiChunks * aiDelayMs + aiCalls * 4000;      // asumsi kasar ~4 dtk per call Groq
    report.aiProjection = {
      itemsToClassify: aiItems.length,
      droppedByMaxItems: Math.max(0, cleaned.items.length - aiItems.length),
      groqCalls: aiCalls,
      apiKeys: keys,
      callsPerKeyIfEven: keys ? Math.ceil(aiCalls / keys) : null,
      projectedMs: aiMs,
      note: 'Asumsi ~4 dtk per call. Rotasi key hanya pindah saat key habis/ditolak, jadi key pertama menanggung beban sampai limit.',
    };
    projectedMs += aiMs;
  }

  report.timing = { wallMs: Date.now() - wallStart, projectedTotalMs: projectedMs, projectedTotalMin: Math.round(projectedMs / 600) / 100 };
  report.health = healthFlags(report);
  report.file = await saveReport('cron', report, targets.entity?.id);
  log(`laporan disimpan ke DB: ${report.file}`);
  ctx.onReport?.(report);
  return report;
}

// ─── Crawl semua perusahaan (portofolio) ───────────────
// Berurutan per perusahaan (bukan serentak): tiap perusahaan -> snapshot keuangan -> crawl terpecah (work1, work2, ... dengan jeda)
// -> clean -> klasifikasi AI terpecah -> simpan ke DB -> (opsional) analisis AI. Jeda antar perusahaan supaya sumber tidak membatasi akses.
const PORTFOLIO_SOURCES = ['google_news', 'bing_news', 'youtube'];

export async function runPortfolio(opts = {}, ctx = {}) {
  const log = ctx.log || (() => {});
  const progress = ctx.progress || (() => {});
  const all = await listCompanies();
  const wanted = Array.isArray(opts.companies) && opts.companies.length ? new Set(opts.companies) : null;
  const selected = all.filter((c) => !wanted || wanted.has(c.id));
  const skip = new Set(opts.skipCompanies || []);                 // sudah selesai pada run sebelumnya (checkpoint)
  const companies = selected.filter((c) => !skip.has(c.id));
  ctx.checkpoint?.({ total: selected.length });
  if (skip.size) log('melanjutkan: ' + skip.size + ' perusahaan yang sudah selesai dilewati');
  if (!companies.length) throw new Error('Tidak ada perusahaan yang dipilih.');
  const companyDelayMs = clamp(num(opts.companyDelayMs, 20000), 0, 3_600_000);
  const doClassify = opts.classify !== false;
  const doFinancial = opts.financial !== false;
  const doAnalysis = opts.analysis !== false;      // default: semua fitur dipakai
  const doDossier = opts.dossier !== false && doClassify;      // dossier dibaca dari isi berita yang sudah dinilai AI, jadi ikut dilewati bila crawl tanpa AI
  const sources = Array.isArray(opts.sources) && opts.sources.length ? opts.sources : PORTFOLIO_SOURCES;
  // Query dasar + topik dossier (akta/pemilik, klien/proyek, kredit/bank). Ditambah per perusahaan: perusahaan terbuka -> rumor pasar, tertutup -> perkara hukum.
  const customMods = Array.isArray(opts.modifiers) && opts.modifiers.length ? opts.modifiers : null;
  const modifiers = customMods || ['none', 'isu', 'deed', 'klien', 'kredit'];

  log(`${companies.length} perusahaan, berurutan, jeda ${companyDelayMs / 1000}s antar perusahaan; sumber: ${sources.join(', ')}`);
  const t0 = Date.now();
  const rows = [];

  for (let i = 0; i < companies.length; i++) {
    throwIfAborted(ctx.signal);
    const co = companies[i];
    const base = { company: co.name, companyIndex: i + 1, companyTotal: companies.length };
    const sub = { ...ctx, progress: (p) => progress({ ...p, ...base }), onReport: undefined };
    const row = { company: co.ticker || co.id, financial: '-', crawled: 0, saved: 0, newItems: 0, aiFailed: 0, analysis: '-', dossier: '-', status: 'ok', ms: 0 };
    const c0 = Date.now();
    progress({ stage: 'company', done: i, total: companies.length, ...base });
    log(`── [${i + 1}/${companies.length}] ${co.name}`);
    // Checkpoint per langkah: langkah yang sudah selesai pada run sebelumnya (opts.skipSteps) dilewati saat Lanjutkan, jadi yang diulang hanya yang gagal.
    const stepDone = (st) => Boolean(opts.skipSteps?.[co.id]?.includes(st));
    const mark = (st) => ctx.checkpoint?.({ company: co.id, step: st });

    try {
      if (stepDone('crawl')) log('crawl perusahaan ini sudah selesai pada run sebelumnya: dilewati');
      else {
      if (doFinancial && co.type === 'public' && co.ticker) {
        try {
          const f = await getFinancials(co.ticker);
          const bad = f.errors?.price || f.errors?.valuation;
          if (!bad) await saveFinancial(co.id, f);
          row.financial = bad ? `sebagian gagal (${f.errors.price || f.errors.valuation})` : 'tersimpan';
          log(`keuangan ${co.ticker}: ${row.financial}`);
        } catch (e) { row.financial = 'gagal: ' + e.message; log(`keuangan ${co.ticker} gagal: ${e.message}`); }
      }

      const reports = await runCron({
        company: co.id, sources, modifiers: customMods || [...modifiers, co.type === 'public' ? 'rumor' : 'hukum'], classify: doClassify,
        chunkSize: opts.chunkSize, delayMs: opts.delayMs, aiChunk: opts.aiChunk, aiDelayMs: opts.aiDelayMs,
        concurrency: opts.concurrency, maxAgeDays: opts.maxAgeDays,
      }, sub);
      const rep = reports.at(-1);
      row.crawled = rep?.clean?.output ?? 0;
      row.saved = rep?.saved?.saved ?? 0;
      row.newItems = rep?.saved?.inserted ?? 0;
      row.aiFailed = rep?.ai?.aiFailed ?? 0;
      try { const rp = await getRiskProfile(co, null); await saveRiskProfile(co.id, rp, 'crawl'); row.risiko = rp.ratingLabel + ' (' + rp.score + ')'; log('profil risiko disimpan: ' + rp.ratingLabel + ' (skor ' + rp.score + ')'); } catch (e) { log('profil risiko gagal: ' + e.message); }
      mark('crawl');
      }

      // Analisis AI: dibuat ulang mingguan (lihat freshAnalysisAge), bukan tiap crawl.
      const anaAge = doAnalysis ? await freshAnalysisAge(co.id, opts) : null;
      if (stepDone('analysis')) { row.analysis = 'sudah selesai (dilewati)'; log('analisis AI sudah selesai pada run sebelumnya: dilewati'); }
      else if (doAnalysis && anaAge !== null) {
        row.analysis = 'dilewati (dibuat ' + umurTxt(anaAge) + ')';
        mark('analysis');
        log('analisis AI dilewati: dibuat ' + umurTxt(anaAge) + '; dibuat ulang setelah ' + everyDaysOf(opts) + ' hari');
      } else if (doAnalysis) {
        try {
          const fin = co.type === 'public' && co.ticker ? await getFinancials(co.ticker).catch(() => null) : null;
          await saveAnalysis(co.id, await generateAnalysis(co, fin));
          row.analysis = 'dibuat';
          mark('analysis');
          log('analisis AI dibuat');
        } catch (e) { row.analysis = 'gagal: ' + e.message; log(`analisis AI gagal: ${e.message}`); }
      }

      // Dossier korporasi (4 bagian) memakai isi berita yang baru saja disimpan dan dinilai, jadi dibuat paling akhir.
      // Dilewati bila dossier yang ada masih segar menurut jadwal mingguan.
      if (stepDone('dossier')) { row.dossier = 'sudah selesai (dilewati)'; log('dossier sudah selesai pada run sebelumnya: dilewati'); }
      else if (doDossier) {
        const dosAge = await freshDossierAge(co.id, opts);
        if (dosAge !== null) { row.dossier = 'dilewati (dibuat ' + umurTxt(dosAge) + ')'; mark('dossier'); log('dossier dilewati: dibuat ' + umurTxt(dosAge) + '; dibuat ulang setelah ' + everyDaysOf(opts) + ' hari'); }
        else {
          try {
            const d = await generateCompanyDossier(co.id, { signal: ctx.signal });
            row.dossier = d.stats.total_items + ' temuan';
            mark('dossier');
            log('dossier dibuat: ' + d.stats.total_items + ' temuan (' + d.stats.verified_count + ' terverifikasi dokumen/profil)');
          } catch (e) { if (e.code === 'CANCELLED') throw e; row.dossier = 'gagal: ' + e.message; log('dossier gagal: ' + e.message); }
        }
      }

      // Langkah yang gagal (mis. model AI sibuk) menjadikan perusahaan ini GAGAL: tidak masuk checkpoint, job berstatus gagal-sebagian, dan Lanjutkan hanya mengulang ini.
      const failedSteps = [/^gagal/.test(row.analysis) && 'analisis AI', /^gagal/.test(row.dossier) && 'dossier'].filter(Boolean);
      if (failedSteps.length) throw new Error(failedSteps.join(' dan ') + ' gagal (langkah lain sudah tersimpan)');
    } catch (e) {
      if (e.code === 'CANCELLED') throw e;
      row.status = 'error: ' + e.message;
      log(`${co.name} gagal: ${e.message}`);        // satu perusahaan gagal tidak menghentikan yang lain
    }
    row.ms = Date.now() - c0;
    rows.push(row);
    if (row.status === 'ok') ctx.checkpoint?.({ done: co.id });
    progress({ stage: 'company', done: i + 1, total: companies.length, ...base });

    if (i < companies.length - 1 && companyDelayMs) {
      log(`jeda ${companyDelayMs / 1000}s sebelum perusahaan berikutnya`);
      await sleepAbortable(companyDelayMs, ctx.signal);
    }
  }

  const report = {
    type: 'portfolio', createdAt: new Date().toISOString(),
    config: { companies: companies.length, sources, modifiers, classify: doClassify, financial: doFinancial, analysis: doAnalysis, companyDelayMs, chunkSize: opts.chunkSize ?? 6 },
    perWork: rows,
    clean: { perusahaanBerhasil: rows.filter((r) => r.status === 'ok').length, perusahaanGagal: rows.filter((r) => r.status !== 'ok').length, beritaBaru: rows.reduce((s, r) => s + r.newItems, 0), beritaDiproses: rows.reduce((s, r) => s + r.saved, 0) },
    timing: { totalMs: Date.now() - t0, totalMin: Math.round((Date.now() - t0) / 600) / 100 },
    health: rows.filter((r) => r.status !== 'ok').map((r) => `${r.company}: ${r.status}`).concat(rows.filter((r) => r.aiFailed > 0).map((r) => `${r.company}: ${r.aiFailed} item gagal diklasifikasi AI`)),
  };
  report.file = await saveReport('portfolio', report);
  log(`selesai: ${report.clean.perusahaanBerhasil}/${rows.length} perusahaan, ${report.clean.beritaBaru} berita baru. Laporan: ${report.file}`);
  ctx.onReport?.(report);
  return [report];
}

// ─── Pipeline lanjutan (tiap perusahaan, berurutan) ────
async function forEachCompany(opts, ctx, label, fn) {
  const log = ctx.log || (() => {});
  const progress = ctx.progress || (() => {});
  const all = await listCompanies();
  const wanted = Array.isArray(opts.companies) && opts.companies.length ? new Set(opts.companies) : null;
  const selected = all.filter((c) => !wanted || wanted.has(c.id));
  const skip = new Set(opts.skipCompanies || []);                 // sudah selesai pada run sebelumnya (checkpoint)
  const companies = selected.filter((c) => !skip.has(c.id));
  ctx.checkpoint?.({ total: selected.length });
  if (skip.size) log('melanjutkan: ' + skip.size + ' perusahaan yang sudah selesai dilewati');
  log(label + ': ' + companies.length + ' perusahaan');
  const rows = [];
  for (let i = 0; i < companies.length; i++) {
    throwIfAborted(ctx.signal);
    const co = companies[i];
    progress({ stage: 'company', done: i, total: companies.length, company: co.name, companyIndex: i + 1, companyTotal: companies.length });
    log('── [' + (i + 1) + '/' + companies.length + '] ' + co.name);
    try { rows.push({ company: co.ticker || co.id, ...(await fn(co)), status: 'ok' }); ctx.checkpoint?.({ done: co.id }); }
    catch (e) { if (e.code === 'CANCELLED') throw e; rows.push({ company: co.ticker || co.id, ...(e.row || {}), status: 'error: ' + e.message }); log(co.name + ' gagal: ' + e.message); }      // tidak masuk checkpoint: Lanjutkan mengulang hanya yang gagal
  }
  progress({ stage: 'company', done: companies.length, total: companies.length });
  return rows;
}
async function finishSimple(type, rows, ctx, extra = {}) {
  const report = {
    type, createdAt: new Date().toISOString(), config: { companies: rows.length }, perWork: rows,
    clean: { perusahaanBerhasil: rows.filter((r) => r.status === 'ok').length, perusahaanGagal: rows.filter((r) => r.status !== 'ok').length, ...extra },
    timing: {}, health: rows.filter((r) => r.status !== 'ok').map((r) => r.company + ': ' + r.status),
  };
  report.file = await saveReport('portfolio', report);
  ctx.log?.('selesai. Laporan: ' + report.file);
  ctx.onReport?.(report);
  return [report];
}

// Perbarui data keuangan semua emiten (harga, valuasi, laporan keuangan) ke snapshot DB, berurutan dengan jeda agar sumber tidak membatasi akses.
export async function runFinancial(opts = {}, ctx = {}) {
  const delay = clamp(num(opts.delayMs, 4000), 0, 60_000);
  const rows = await forEachCompany(opts, ctx, 'perbarui data keuangan', async (co) => {
    if (co.type !== 'public' || !co.ticker) { ctx.log?.('dilewati: bukan emiten'); return { hasil: 'dilewati (tertutup)' }; }
    const f = await getFinancials(co.ticker, { force: true });
    const bad = f.errors?.price || f.errors?.valuation;
    if (!bad) await saveFinancial(co.id, f, { force: true });
    ctx.log?.(bad ? 'sebagian gagal: ' + bad : 'tersimpan ' + co.ticker);
    await sleepAbortable(delay, ctx.signal);
    return { hasil: bad ? 'sebagian gagal: ' + bad : 'tersimpan' };
  });
  return finishSimple('financial', rows, ctx);
}

// Ambil isi artikel (content_html) dan gambar (og:image) untuk berita yang belum punya, dari satu kali unduh per artikel. Tanpa AI, URL tidak diubah.
// opts.retry (default true): ikut mencoba lagi yang gagal sebelumnya. Jalur 'ai' ikut dikunci supaya klasifikasi tidak jalan sebelum isinya ada.
export async function runContent(opts = {}, ctx = {}) {
  const limit = clamp(num(opts.limit, 300), 1, 2000);
  const rows = await forEachCompany(opts, ctx, 'ambil isi & gambar artikel', async (co) => {
    const r = await enrichContentHtml(co.id, { limit, retry: opts.retry !== false, signal: ctx.signal });
    ctx.log?.('isi tersimpan ' + r.content + ', gambar ' + r.images + ', alamat penerbit diselesaikan ' + r.resolved + ' dari ' + r.checked + ' berita dicek' + (r.unresolved ? '; ' + r.unresolved + ' tautan Google belum bisa diselesaikan' : ''));
    if (r.stoppedByRateLimit) ctx.log?.('Google membatasi permintaan (429): sisa berita dihentikan, jalankan lagi beberapa menit lagi');
    return { dicek: r.checked, isiTersimpan: r.content, gambar: r.images, alamatDiselesaikan: r.resolved, belumSelesai: r.unresolved };
  });
  return finishSimple('content', rows, ctx);
}

// Analisis AI satu perusahaan (data keuangan + berita 30 hari), disimpan sebagai riwayat.
async function analyzeCompany(co, ctx) {
  const fin = co.type === 'public' && co.ticker ? await getFinancials(co.ticker).catch(() => null) : null;
  const a = await generateAnalysis(co, fin);
  await saveAnalysis(co.id, a);
  ctx.log?.('analisis dibuat: ' + a.headline);
  return a;
}

// Buat ulang analisis AI semua perusahaan (data keuangan + berita 30 hari).
export async function runAnalysisAll(opts = {}, ctx = {}) {
  const delay = clamp(num(opts.delayMs, 3000), 0, 600_000);
  const rows = await forEachCompany(opts, ctx, 'analisis AI', async (co) => {
    const a = await analyzeCompany(co, ctx);
    await sleepAbortable(delay, ctx.signal);
    return { kondisi: a.kondisi, berita: a.newsCount };
  });
  return finishSimple('analysis', rows, ctx);
}

// Klasifikasi AI satu perusahaan untuk berita yang belum dinilai / formatnya lama (maks. 300 per jalan). Isi artikel (content_html) ikut dibaca AI.
async function reclassifyCompany(co, opts, ctx) {
  const chunk = clamp(num(opts.aiChunk, 60), 1, 200);
  const delay = clamp(num(opts.aiDelayMs, 3000), 0, 600_000);
  const [todo] = await db().query(
    "SELECT HEX(url_hash) AS h, COALESCE(article_url, found_url) AS url, title, snippet, content_html, source_name, source_domain, image_url, UNIX_TIMESTAMP(sort_at) AS ts FROM news_items WHERE company_id = ? AND COALESCE(article_url, found_url) NOT LIKE 'https://news.google.com/%' AND COALESCE(article_url, found_url) NOT LIKE 'https://www.google.com/search%' AND COALESCE(article_url, found_url) NOT LIKE 'https://google.com/search%' AND " + INCOMPLETE_SQL + " ORDER BY sort_at DESC LIMIT 300",
    [co.id],
  );
  ctx.log?.(todo.length + ' berita belum terklasifikasi');
  let ok = 0, bad = 0;
  for (let i = 0; i < todo.length; i += chunk) {
    throwIfAborted(ctx.signal);
    const items = todo.slice(i, i + chunk).map((r, k) => ({
      id: k + 1, urlHash: r.h, platform: r.source_name || r.source_domain || '', url: r.url, title: r.title, snippet: r.snippet, fullContent: htmlToText(r.content_html) || undefined,
      text: [r.title, r.snippet].filter(Boolean).join(' — '), date: new Date(r.ts * 1000).toISOString(),
      sourceName: r.source_name, image: r.image_url || undefined,
    }));
    const out = await classifyItems(items, { ...co, keyword: (co.aliases || []).join(', ') });
    await saveNews(co.id, out, { dedupe: false });
    ok += out.filter((o) => !o.ai?.error).length; bad += out.filter((o) => o.ai?.error).length;
    ctx.log?.('batch ' + (Math.floor(i / chunk) + 1) + '/' + Math.ceil(todo.length / chunk) + ': ' + ok + ' ok, ' + bad + ' gagal');
    if (i + chunk < todo.length) await sleepAbortable(delay, ctx.signal);
  }
  return { diproses: todo.length, berhasil: ok, gagal: bad };
}

// Klasifikasi ulang berita yang AI-nya gagal/dilewati (mis. kuota Groq habis saat crawl).
export async function runReclassify(opts = {}, ctx = {}) {
  const rows = await forEachCompany(opts, ctx, 'klasifikasi ulang', (co) => reclassifyCompany(co, opts, ctx));
  return finishSimple('reclassify', rows, ctx);
}

// Lengkapi data yang sudah tersimpan (mis. hasil crawl lama sebelum isi artikel, klasifikasi, analisis, dan dossier ada).
// Per perusahaan, urutannya sama dengan crawl: isi & gambar -> klasifikasi AI -> analisis AI -> dossier. Tiap langkah memakai hasil langkah sebelumnya.
// CHECKPOINT PER LANGKAH: tiap langkah yang beres dicatat. Bila ada yang gagal (mis. model AI sibuk), perusahaan itu dianggap GAGAL (tidak masuk checkpoint),
// job berstatus gagal-sebagian, dan Lanjutkan hanya mengulang perusahaan itu, mulai dari langkah yang belum beres.
export async function runBackfill(opts = {}, ctx = {}) {
  const limit = clamp(num(opts.limit, 300), 1, 2000);
  const delay = clamp(num(opts.delayMs, 2000), 0, 600_000);
  const log = ctx.log || (() => {});
  const rows = await forEachCompany(opts, ctx, 'lengkapi data tersimpan', async (co) => {
    const row = {}, errors = [];
    const done = (st) => Boolean(opts.skipSteps?.[co.id]?.includes(st));
    const mark = (st) => ctx.checkpoint?.({ company: co.id, step: st });
    const failNow = (msg) => { throw Object.assign(new Error(msg), { row }); };

    if (done('content')) log('1/4 isi & gambar artikel: sudah selesai, dilewati');
    else {
      log('1/4 ambil isi & gambar artikel');
      const c = await enrichContentHtml(co.id, { limit, retry: opts.retry !== false, signal: ctx.signal });
      row.isiTersimpan = c.content; row.gambar = c.images; row.alamatDiselesaikan = c.resolved;
      if (c.stoppedByRateLimit) log('Google membatasi permintaan (429): sebagian tautan menyusul lain kali');
      throwIfAborted(ctx.signal);
      mark('content');
    }

    if (done('classify')) log('2/4 klasifikasi AI: sudah selesai, dilewati');
    else {
      log('2/4 klasifikasi AI');
      const r = await reclassifyCompany(co, opts, ctx);
      row.dinilaiAI = r.berhasil; row.gagalAI = r.gagal;
      if (r.diproses > 0 && r.berhasil === 0) failNow('klasifikasi AI gagal total (AI tidak menjawab); analisis dan dossier ditunda');
      if (r.gagal > 0) errors.push(r.gagal + ' berita gagal diklasifikasi');       // sebagian: lanjut, tapi langkah ini belum ditandai selesai
      else mark('classify');
      throwIfAborted(ctx.signal);
    }

    if (done('analysis')) log('3/4 analisis AI: sudah selesai, dilewati');
    else {
      const anaAge = await freshAnalysisAge(co.id, opts);
      if (anaAge !== null) { row.analisis = 'dilewati (dibuat ' + umurTxt(anaAge) + ')'; mark('analysis'); log('3/4 analisis AI dilewati: dibuat ' + umurTxt(anaAge) + '; dibuat ulang setelah ' + everyDaysOf(opts) + ' hari'); }
      else {
      log('3/4 analisis AI');
      try { const a = await analyzeCompany(co, ctx); row.analisis = a.kondisi; mark('analysis'); }
      catch (e) { if (e.code === 'CANCELLED') throw e; row.analisis = 'gagal: ' + e.message; errors.push('analisis AI gagal'); log('analisis gagal: ' + e.message); }
      }
      throwIfAborted(ctx.signal);
    }

    if (done('dossier')) log('4/4 dossier: sudah selesai, dilewati');
    else {
      const dosAge = await freshDossierAge(co.id, opts);
      if (dosAge !== null) { row.dossier = 'dilewati (dibuat ' + umurTxt(dosAge) + ')'; mark('dossier'); log('4/4 dossier dilewati: dibuat ' + umurTxt(dosAge) + '; dibuat ulang setelah ' + everyDaysOf(opts) + ' hari'); }
      else {
      log('4/4 dossier korporasi');
      try { const d = await generateCompanyDossier(co.id, { signal: ctx.signal }); row.dossier = d.stats.total_items + ' temuan'; mark('dossier'); log('dossier dibuat: ' + d.stats.total_items + ' temuan'); }
      catch (e) { if (e.code === 'CANCELLED') throw e; row.dossier = 'gagal: ' + e.message; errors.push('dossier gagal'); log('dossier gagal: ' + e.message); }
      }
    }

    if (errors.length) failNow(errors.join('; ') + ' (langkah lain sudah tersimpan)');
    await sleepAbortable(delay, ctx.signal);
    return row;
  });
  return finishSimple('backfill', rows, ctx);
}

// Hitung ulang keterkaitan nama (judul + cuplikan + isi artikel), platform, dan jenis konten untuk semua berita tersimpan (tanpa AI, cepat).
// Berita yang BELUM dinilai AI (termasuk hasil AI lama tanpa company_role, yang tag/dampaknya berasal dari kata kunci) dibersihkan dari tag risiko,
// dampak, dan penanda "konsumen" lama (dikosongkan, bukan ditebak); hasil penilaian AI format baru tidak pernah ditimpa.
const NEW_AI = "ai_status = 'ok' AND company_role IS NOT NULL";
export async function runRescore(opts = {}, ctx = {}) {
  const rows = await forEachCompany(opts, ctx, 'hitung ulang keterkaitan nama & bersihkan hasil kata kunci', async (co) => {
    const match = buildMatcher(co);
    const [items] = await db().query('SELECT id, title, snippet, LEFT(content_html, 30000) AS content_html, COALESCE(article_url, found_url) AS url, source_domain, credibility_tier FROM news_items WHERE company_id = ?', [co.id]);
    let related = 0;
    for (const it of items) {
      throwIfAborted(ctx.signal);
      const rel = match(it.title + ' ' + (it.snippet || '') + ' ' + htmlToText(it.content_html));
      if (rel.related) related++;
      let host = it.source_domain; try { host ||= new URL(it.url).hostname; } catch { /* host kosong */ }
      const platform = platformOf({ domain: host, tier: it.credibility_tier });
      const kind = contentKind({ tier: it.credibility_tier, platform });
      await db().query(
        `UPDATE news_items SET related = ?, related_via = ?, title_hash = ?, platform = ?,
           risk_tags = IF(${NEW_AI}, risk_tags, NULL), risk_level = IF(${NEW_AI}, risk_level, 0),
           impact = IF(${NEW_AI}, impact, NULL), impact_reason = IF(${NEW_AI}, impact_reason, NULL),
           content_kind = IF(${NEW_AI} AND content_kind = 'konsumen', 'konsumen', ?) WHERE id = ?`,
        [rel.related ? 1 : 0, rel.via, createHash('sha1').update(normTitle(it.title)).digest(), platform, kind, it.id],
      );
    }
    const [[st]] = await db().query(`SELECT SUM(${NEW_AI}) dinilai, SUM(NOT (${NEW_AI})) belum, SUM(content_kind = 'konsumen') konsumen FROM news_items WHERE company_id = ?`, [co.id]);
    ctx.log?.(items.length + ' berita mentah: ' + related + ' menyebut perusahaan/pemangku kepentingan; ' + st.dinilai + ' sudah dinilai AI, ' + st.belum + ' belum dinilai (tanpa tag risiko/dampak); ' + st.konsumen + ' ditandai konsumen oleh AI');
    return { mentah: items.length, menyebutNama: related, dinilaiAI: Number(st.dinilai), belumDinilai: Number(st.belum), konsumenOlehAI: Number(st.konsumen) };
  });
  return finishSimple('rescore', rows, ctx);
}

// Ekstrak dossier korporasi 4-bagian (Pemilik manfaat, Klien/proyek, Akta/korporasi, Fasilitas bank) untuk semua perusahaan.
export async function runDossierAll(opts = {}, ctx = {}) {
  const delay = clamp(num(opts.delayMs, 2000), 0, 600_000);
  const rows = await forEachCompany(opts, ctx, 'ekstrak dossier korporasi', async (co) => {
    const d = await generateCompanyDossier(co.id, { signal: ctx.signal });
    ctx.log?.('dossier dibuat: ' + d.stats.total_items + ' item (' + d.stats.verified_count + ' terverifikasi dokumen/profil)');
    await sleepAbortable(delay, ctx.signal);
    return { totalItem: d.stats.total_items, terverifikasi: d.stats.verified_count, belumVerifikasi: d.stats.unverified_count };
  });
  return finishSimple('dossier', rows, ctx);
}

// ─── Job manager (di memori, satu job aktif sekaligus) ─
const RUNNERS = { cron: runCron, portfolio: runPortfolio, content: runContent, analysis: runAnalysisAll, reclassify: runReclassify, rescore: runRescore, financial: runFinancial, dossier: runDossierAll, backfill: runBackfill };
const ACTIVE = new Set(['running', 'waiting']);
// Disimpan di globalThis: Next.js memuat modul ini terpisah untuk tiap route (dan instrumentation), sehingga Map biasa tidak terlihat oleh route lain.
const JOBS = (globalThis.__msJobs ??= new Map());
const MAX_KEEP = 20;
const MAX_LOGS = 500;

// ─── Jalur (lane): job yang tidak saling berebut boleh berjalan bersamaan ───
//   crawl = mengambil data dari internet (Google/Bing/YouTube, harga, gambar)  -> tidak berbagi apa pun dengan AI
//   ai    = memakai kuota AI (Groq/Gemini): klasifikasi, analisis                -> satu job AI saja agar kuota tidak berebut
//   db    = pemeliharaan data (hitung ulang, buang duplikat)                     -> eksklusif: tidak boleh bersamaan dengan job lain
// Dua job hanya boleh berjalan bersamaan bila tidak berbagi jalur. Simpan ke DB aman dari dua job (upsert idempoten, hasil AI tidak ditimpa).
export function lanesOf(type, opts = {}) {
  switch (type) {
    case 'portfolio': return opts.classify === false && opts.analysis === false ? ['crawl'] : ['crawl', 'ai'];
    case 'reclassify': case 'analysis': case 'dossier': return ['ai'];
    case 'backfill': return ['crawl', 'ai'];          // mengambil isi lalu AI membacanya: keduanya terkunci
    case 'content': return ['crawl', 'ai'];            // mengambil isi & gambar: AI membaca isi itu, jadi tidak boleh berjalan bersamaan dengan job AI
    case 'financial': return ['crawl'];
    case 'rescore': return ['db'];
    default: return ['crawl', 'ai'];            // cron
  }
}
const lanesConflict = (a, b) => a.includes('db') || b.includes('db') || a.some((l) => b.includes(l));

const MULTI = new Set(['portfolio', 'content', 'analysis', 'reclassify', 'rescore', 'financial', 'dossier', 'backfill']);
// Sudah pernah dilanjutkan (ada job lain yang resumedFrom-nya job ini): tidak boleh dilanjutkan dua kali.
const resumedBy = (id) => [...JOBS.values()].some((j) => j.resumedFrom === id);
export function publicJob(job) {
  const { _controller, _chain, ...rest } = job;
  const cp = job.checkpoint || { done: [], total: 0 };
  // Bisa dilanjutkan: job multi-perusahaan yang berhenti sebelum semua perusahaan selesai dan belum pernah dilanjutkan
  rest.lanes = job.lanes || lanesOf(job.type, job.opts);
  rest.resumable = MULTI.has(job.type) && ['interrupted', 'cancelled', 'error'].includes(job.status) && cp.total > 0 && cp.done.length < cp.total && !resumedBy(job.id);
  return rest;
}

// Simpan status job ke DB (tahan restart). Kesalahan DB tidak boleh menghentikan job.
// Penyimpanan per job diantrekan (satu per satu, selalu memakai keadaan TERBARU saat giliran tiba) supaya snapshot lama tidak menimpa snapshot baru,
// dan beatAt (detak terakhir) ikut tersimpan: dipakai untuk mengetahui kapan job benar-benar berhenti bila server mati mendadak.
const persist = (job) => {
  job.progress = { ...job.progress, beatAt: Date.now() };
  job._chain = (job._chain || Promise.resolve()).then(() => saveJobRun(job)).catch((e) => console.error('[db] saveJobRun:', e.message));
  return job._chain;
};

// Dipanggil saat server dimatikan baik-baik (Ctrl+C / restart): tandai semua job aktif 'interrupted' dengan checkpoint terbaru, lalu tunggu tersimpan.
export async function flushJobs() {
  const active = [...JOBS.values()].filter((j) => ACTIVE.has(j.status));
  await Promise.all(active.map((j) => j._chain));
  const now = Date.now();
  await Promise.all(active.map((j) => saveJobRun({
    ...j, status: 'interrupted', finishedAt: now, progress: { ...j.progress, beatAt: now },
    logs: [...j.logs, `${new Date(now).toLocaleTimeString('id-ID', { hour12: false })}  server dihentikan: job ditandai terputus, bisa dilanjutkan dari checkpoint`],
  }).catch((e) => console.error('[db] flushJobs:', e.message))));
  return active.length;
}

// Dipanggil sekali saat server start: tandai job yang terputus dan muat riwayat terakhir supaya log & tombol Lanjutkan tersedia.
export async function recoverJobs() {
  const n = await markJobsInterrupted();
  for (const r of await listJobRuns(10)) JOBS.set(r.id, { ...r, reports: [], _controller: null });
  if (n) console.warn('[jobs] ' + n + ' job terputus saat server mati; bisa dilanjutkan dari Task Runner');
  // AUTO_RESUME=1 (dipakai pm2): lanjutkan otomatis job terputus yang terbaru dari checkpoint-nya.
  if (n && process.env.AUTO_RESUME === '1') {
    const last = [...JOBS.values()].filter((j) => j.status === 'interrupted' && publicJob(j).resumable).sort((x, y) => y.createdAt - x.createdAt)[0];
    if (last) { try { const nj = resumeJob(last.id); console.log('[jobs] melanjutkan otomatis job ' + last.id + ' sebagai ' + nj.id); } catch (e) { console.error('[jobs] auto-resume gagal:', e.message); } }
  }
  return n;
}

export function resumeJob(id) {
  const old = JOBS.get(id);
  if (!old) throw Object.assign(new Error('job tidak ditemukan'), { status: 404 });
  if (!publicJob(old).resumable) throw Object.assign(new Error('job ini tidak bisa dilanjutkan'), { status: 400 });
  return startJob(old.type, { ...old.opts, skipCompanies: old.checkpoint.done, skipSteps: old.checkpoint.steps || {} }, { resumedFrom: old.id, done: old.checkpoint.done, total: old.checkpoint.total, steps: old.checkpoint.steps });
}

export function listJobs() {
  return [...JOBS.values()].sort((a, b) => b.createdAt - a.createdAt).map((j) => ({
    id: j.id, type: j.type, status: j.status, createdAt: j.createdAt, startedAt: j.startedAt || j.createdAt, finishedAt: j.finishedAt, progress: j.progress,
    opts: { companies: j.opts?.companies, classify: j.opts?.classify },
    lanes: j.lanes || lanesOf(j.type, j.opts), cancelRequested: Boolean(j.cancelRequested), checkpoint: j.checkpoint, resumable: publicJob(j).resumable, resumedFrom: j.resumedFrom || null,
  }));
}

export const getJob = (id) => JOBS.get(id) || null;

export function startJob(type, opts = {}, meta = {}) {
  const runner = RUNNERS[type];
  if (!runner) throw Object.assign(new Error(`tipe job tidak dikenal: ${type}`), { status: 400 });
  const activeJobs = [...JOBS.values()].filter((j) => ACTIVE.has(j.status));
  let note = null;
  // Crawl penuh yang diminta saat jalur AI sedang dipakai job lain: otomatis jalan TANPA AI (klasifikasi menyusul lewat "Klasifikasi ulang"),
  // supaya crawl tidak menunggu dan kuota AI tidak diperebutkan.
  if (type === 'portfolio' && opts.classify === undefined && activeJobs.some((j) => (j.lanes || lanesOf(j.type, j.opts)).includes('ai'))) {
    opts = { ...opts, classify: false, analysis: false };
    note = 'Jalur AI sedang dipakai job lain: crawl ini berjalan tanpa AI. Klasifikasi/analisis menyusul lewat tombol "Klasifikasi ulang" setelah job AI selesai.';
  }
  const lanes = lanesOf(type, opts);
  const clash = activeJobs.find((j) => lanesConflict(j.lanes || lanesOf(j.type, j.opts), lanes));
  if (clash) {
    const why = (clash.lanes || lanesOf(clash.type, clash.opts)).includes('db') || lanes.includes('db') ? 'pemeliharaan data harus berjalan sendiri' : 'jalur yang sama sedang dipakai';
    throw Object.assign(new Error('Tidak bisa dijalankan sekarang: ' + why + ' (' + clash.type + ' ' + clash.id + ' masih berjalan).'), { status: 409 });
  }

  const controller = new AbortController();
  const job = {
    id: randomUUID().slice(0, 8), type, opts, status: 'running',
    createdAt: Date.now(), startedAt: Date.now(), finishedAt: null,
    progress: {}, logs: [], reports: [], error: null, _controller: controller,
    checkpoint: { done: [...(meta.done || [])], total: meta.total || 0, steps: JSON.parse(JSON.stringify(meta.steps || {})) }, resumedFrom: meta.resumedFrom || null, lanes,
  };
  persist(job);
  const saveTimer = setInterval(() => persist(job), 15_000);       // log & progres tetap tersimpan walau server mati mendadak
  JOBS.set(job.id, job);
  for (const id of [...JOBS.keys()].slice(0, Math.max(0, JOBS.size - MAX_KEEP))) if (!ACTIVE.has(JOBS.get(id).status)) JOBS.delete(id);

  const ctx = {
    signal: controller.signal,
    log: (msg) => {
      job.logs.push(`${new Date().toLocaleTimeString('id-ID', { hour12: false })}  ${msg}`);
      if (job.logs.length > MAX_LOGS) job.logs.shift();
    },
    progress: (p) => {
      job.progress = { ...job.progress, ...p };
      job.status = p.stage === 'waiting' ? 'waiting' : 'running';
    },
    onReport: (r) => { job.reports.push(r); if (job.reports.length > 5) job.reports.shift(); },
    checkpoint: ({ done, total, company, step }) => {
      job.checkpoint.steps ||= {};                                   // langkah yang sudah beres per perusahaan: {id: ['content','classify',...]}
      if (total) job.checkpoint.total = total;
      if (company && step) { const a = (job.checkpoint.steps[company] ||= []); if (!a.includes(step)) a.push(step); }
      if (done) { delete job.checkpoint.steps[done]; if (!job.checkpoint.done.includes(done)) job.checkpoint.done.push(done); }      // perusahaan selesai penuh: catatan langkahnya tidak perlu lagi
      persist(job);
    },
  };

  if (note) ctx.log(note);
  runner(opts, ctx)
    .then((reports) => {
      job.status = controller.signal.aborted ? 'cancelled' : 'done';
      // Bila ada perusahaan yang gagal, job TIDAK dianggap selesai: status 'error' (gagal sebagian) supaya tombol Lanjutkan muncul dan hanya mengulang yang gagal.
      const bad = (Array.isArray(reports) ? reports : []).flatMap((r) => r?.perWork || []).filter((w) => w && typeof w.status === 'string' && w.status !== 'ok');
      if (bad.length && job.status === 'done') {
        job.status = 'error';
        job.error = ('Sebagian selesai: ' + bad.length + ' perusahaan gagal (' + bad.map((b) => b.company + ': ' + b.status.replace(/^error: /, '').slice(0, 80)).join('; ') + ')').slice(0, 500);
        ctx.log(bad.length + ' perusahaan gagal. Tombol "Lanjutkan" hanya mengulang yang gagal; yang sudah selesai (termasuk langkah yang sudah beres) dilewati.');
      }
    })
    .catch((e) => {
      job.status = e.code === 'CANCELLED' ? 'cancelled' : 'error';
      if (job.status === 'error') { job.error = e.message; ctx.log(`ERROR: ${e.message}`); }
    })
    .finally(() => { clearInterval(saveTimer); job.finishedAt = Date.now(); job.progress = { ...job.progress, stage: job.status }; persist(job); });

  return job;
}

export function cancelJob(id) {
  const job = JOBS.get(id);
  if (!job) throw Object.assign(new Error('job tidak ditemukan'), { status: 404 });
  if (ACTIVE.has(job.status) && !job.cancelRequested) {
    job.cancelRequested = true;
    job._controller.abort();
    // Sengaja TIDAK memutus batch AI yang sudah berjalan (tokennya sudah terpakai); job berhenti begitu langkah itu selesai dan hasilnya tersimpan.
    job.logs.push('pembatalan diminta: akan berhenti setelah langkah yang sedang berjalan selesai (batch AI tidak diputus agar token tidak terbuang)');
  }
  return job;
}
