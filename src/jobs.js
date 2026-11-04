// Runner simulasi/cron + job manager. Dipakai bersama oleh server (tombol di web, jalan di background)
// dan scripts/*.js (CLI). Runner tidak mencetak ke console sendiri: semua keluaran lewat ctx.
//
//   ctx = { signal, log(msg), progress({stage, done, total, ...}), onReport(report) }
import { randomUUID } from 'node:crypto';
import { cleanItems } from './clean.js';
import { enrichItemsWithContent } from './extractor.js';
import { getFinancials } from './financial.js';
import { markJobsInterrupted, saveAnalysis, saveFinancial, saveJobRun, saveNews, saveReport, saveRiskProfile } from './save.js';
import { getRiskProfile } from './riskprofile.js';
import { generateAnalysis } from './analysis.js';
import { INCOMPLETE_SQL, splitComplete } from './news.js';
import { maxSeverity, riskTags } from './risk.js';
import { NEAR_DUP, buildMatcher, jaccard, normTitle, titleTokens } from './related.js';
import { createHash } from 'node:crypto';
import { contentKind, platformOf } from './kind.js';
import { enrichImages } from './images.js';
import { latestAnalysis, listCompanies, listJobRuns } from './store.js';
import { db } from './db.js';
import { BATCH, aiUsage, classifyItems, geminiKeys, groqKeys, MAX_ITEMS } from './classify.js';
import {
  buildJobs, estimateChunkMs, healthFlags, makeFakeRunner, resolveTargets, runJobs,
  summarizeAi, summarizeClean, summarizeFetch, summarizeRawQuality,
} from './sim-lib.js';

const MAX_REAL_JOBS = 1000;    // pengaman: satu run nyata maksimal 1000 query

const num = (v, d) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

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
  log(`DB: ${report.saved.saved} berita diproses, ${report.saved.inserted} baru${report.saved.duplicates ? `, ${report.saved.duplicates} duplikat dibuang (tidak disimpan)` : ''}`);
  return new Set(report.saved.droppedUrls || []);
}

// ─── Simulasi kualitas data (sekali jalan) ─────────────
// opts: { company | keywords, sources, modifiers, classify, dry, concurrency, maxAgeDays }
export async function runSimulate(opts = {}, ctx = {}) {
  const log = ctx.log || (() => {});
  const progress = ctx.progress || (() => {});
  const concurrency = clamp(num(opts.concurrency, 3), 1, 6);
  const maxAgeDays = clamp(num(opts.maxAgeDays, 7), 1, 60);
  const dry = Boolean(opts.dry);

  const { keywords, sources, modifiers, entity } = await resolveTargets(opts);
  const jobs = buildJobs(keywords, sources, modifiers);
  if (!dry && jobs.length > MAX_REAL_JOBS) throw new Error(`Terlalu banyak query (${jobs.length}); maksimal ${MAX_REAL_JOBS} untuk run nyata.`);
  log(`${keywords.length} keyword x ${sources.length} sumber x ${modifiers.length} modifier = ${jobs.length} query${dry ? ' (DRY: data sintetis)' : ''}`);

  const t0 = Date.now();
  progress({ stage: 'fetch', done: 0, total: jobs.length });
  const run = dry ? makeFakeRunner() : runJobs;
  const results = await run(jobs, { concurrency, signal: ctx.signal, onJob: (n) => progress({ stage: 'fetch', done: n, total: jobs.length }) });
  throwIfAborted(ctx.signal);
  const fetchMs = Date.now() - t0;

  const rawItems = results.flatMap((r) => r.items);
  const failed = results.filter((r) => !r.ok).length;
  log(`fetch selesai: ${rawItems.length} item mentah, ${failed}/${jobs.length} query gagal, ${fetchMs}ms`);

  const report = {
    type: 'simulate',
    createdAt: new Date().toISOString(),
    config: { keywords, sources, modifiers, jobs: jobs.length, dry, concurrency },
    fetch: summarizeFetch(results),
    raw: summarizeRawQuality(rawItems, maxAgeDays),
  };

  // Perusahaan terbuka: cek juga seberapa lengkap data keuangan publiknya (non-AI)
  if (!dry && entity.type === 'public' && entity.ticker) {
    log(`data keuangan ${entity.ticker}...`);
    try {
      const f = await getFinancials(entity.ticker);
      const q = f.fundamentals?.quarterly?.[0];
      report.financial = {
        ticker: f.ticker,
        harga: f.price ? `${f.price.price} ${f.price.currency} (5h ${f.price.change5dPct}%, 1b ${f.price.change1mPct}%)` : 'GAGAL',
        valuasi: f.valuation ? 'ok' : 'GAGAL',
        laporanKeuangan: f.fundamentals ? `${f.fundamentals.quarterly.length} kuartal, ${f.fundamentals.annual.length} tahun (terakhir ${q?.asOf || '-'}, ${f.fundamentals.currency || '?'})` : 'GAGAL',
        pengumumanIdx: f.announcements ? `${f.announcements.length} dalam 90 hari` : `tidak tersedia: ${f.errors.announcements}`,
        sinyal: f.signals.length ? f.signals.map((x) => `[${x.level}] ${x.text}`) : 'tidak ada',
        error: Object.entries(f.errors).map(([k, v]) => `${k}: ${v}`).join('; ') || 'tidak ada',
      };
    } catch (e) {
      report.financial = { ticker: entity.ticker, error: e.message };
    }
  }

  progress({ stage: 'clean', done: 0, total: 1 });
  const cleaned = cleanItems(rawItems);
  report.clean = summarizeClean(cleaned.stats);
  log(`clean: ${cleaned.stats.output}/${cleaned.stats.input} lolos (${report.clean.usablePct}%)`);

  if (!dry && cleaned.items.length) {
    log(`ekstraksi konten: mengambil isi artikel & caption sosmed (${cleaned.items.length} item)...`);
    await enrichItemsWithContent(cleaned.items, {
      concurrency: 6,
      onProgress: (d, tot) => progress({ stage: 'extract', done: d, total: tot })
    });
    log(`ekstraksi selesai: konten lengkap & caption siap`);
  }

  const droppedDup = !dry ? await persistItems(entity, cleaned.items, null, report, log) : new Set();     // berita langsung tersimpan sebelum AI jalan

  if (opts.classify) {
    if (dry) {
      log('klasifikasi AI dilewati pada mode DRY (tidak memanggil Groq).');
    } else {
      const sp = entity?.id ? await splitComplete(entity.id, cleaned.items.filter((it) => !droppedDup.has(it.url))) : { todo: cleaned.items, complete: [] };
      if (sp.complete.length) { log(`${sp.complete.length} berita sudah terklasifikasi lengkap: dilewati`); report.aiSkippedComplete = sp.complete.length; }
      const items = sp.todo.slice(0, MAX_ITEMS);
      log(`klasifikasi AI ${items.length} item dengan ${groqKeys().length} key Groq + ${geminiKeys().length} Gemini`);
      const classified = [];
      const step = BATCH * 3;
      for (let i = 0; i < items.length; i += step) {
        throwIfAborted(ctx.signal);
        const out = await classifyItems(items.slice(i, i + step), entity);
        classified.push(...out);
        if (entity?.id) await saveNews(entity.id, out, { dedupe: false });        // perbarui per batch: tidak hilang bila job berhenti
        progress({ stage: 'ai', done: Math.min(i + step, items.length), total: items.length });
      }
      report.ai = summarizeAi(classified);
      log(`AI selesai: ${report.ai.aiOk} ok, ${report.ai.aiFailed} gagal`);
    }
  }

  report.timing = { fetchMs, totalMs: Date.now() - t0 };
  report.health = healthFlags(report);
  report.file = await saveReport('simulate', report, entity.id);
  log(`laporan disimpan ke DB: ${report.file}`);
  ctx.onReport?.(report);
  return [report];
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

  let jobs = buildJobs(targets.keywords, targets.sources, targets.modifiers);
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

  const allResults = [];
  const perWork = [];
  let projectedMs = 0;
  const wallStart = Date.now();

  for (let i = 0; i < chunks.length; i++) {
    throwIfAborted(ctx.signal);
    const label = `work${i + 1}`;
    progress({ stage: 'crawl', cycle, work: label, done: i, total: chunks.length });
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
    progress({ stage: 'crawl', cycle, work: label, done: i + 1, total: chunks.length });
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
  log(`clean: ${cleaned.stats.output}/${cleaned.stats.input} lolos`);

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
    await enrichItemsWithContent(cleaned.items, {
      concurrency: 6,
      onProgress: (d, tot) => progress({ stage: 'extract', cycle, done: d, total: tot })
    });
    log(`ekstraksi selesai: konten lengkap & caption siap`);
  }

  const droppedDup = !dry ? await persistItems(targets.entity, cleaned.items, null, report, log) : new Set();     // berita langsung tersimpan sebelum AI jalan

  const sp = !dry && targets.entity?.id ? await splitComplete(targets.entity.id, cleaned.items.filter((it) => !droppedDup.has(it.url))) : { todo: cleaned.items, complete: [] };
  if (sp.complete.length) { log(`${sp.complete.length} berita sudah terklasifikasi lengkap: dilewati (tidak dikirim ke AI)`); report.aiSkippedComplete = sp.complete.length; }
  const aiItems = sp.todo.slice(0, MAX_ITEMS);
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
  const sources = Array.isArray(opts.sources) && opts.sources.length ? opts.sources : PORTFOLIO_SOURCES;
  const modifiers = Array.isArray(opts.modifiers) && opts.modifiers.length ? opts.modifiers : ['none', 'isu'];

  log(`${companies.length} perusahaan, berurutan, jeda ${companyDelayMs / 1000}s antar perusahaan; sumber: ${sources.join(', ')}`);
  const t0 = Date.now();
  const rows = [];

  for (let i = 0; i < companies.length; i++) {
    throwIfAborted(ctx.signal);
    const co = companies[i];
    const base = { company: co.name, companyIndex: i + 1, companyTotal: companies.length };
    const sub = { ...ctx, progress: (p) => progress({ ...p, ...base }), onReport: undefined };
    const row = { company: co.ticker || co.id, financial: '-', crawled: 0, saved: 0, newItems: 0, aiFailed: 0, analysis: '-', status: 'ok', ms: 0 };
    const c0 = Date.now();
    progress({ stage: 'company', done: i, total: companies.length, ...base });
    log(`── [${i + 1}/${companies.length}] ${co.name}`);

    try {
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
        company: co.id, sources, modifiers, classify: doClassify,
        chunkSize: opts.chunkSize, delayMs: opts.delayMs, aiChunk: opts.aiChunk, aiDelayMs: opts.aiDelayMs,
        concurrency: opts.concurrency, maxAgeDays: opts.maxAgeDays,
      }, sub);
      const rep = reports.at(-1);
      row.crawled = rep?.clean?.output ?? 0;
      row.saved = rep?.saved?.saved ?? 0;
      row.newItems = rep?.saved?.inserted ?? 0;
      row.aiFailed = rep?.ai?.aiFailed ?? 0;
      try { const rp = await getRiskProfile(co, null); await saveRiskProfile(co.id, rp, 'crawl'); row.risiko = rp.ratingLabel + ' (' + rp.score + ')'; log('profil risiko disimpan: ' + rp.ratingLabel + ' (skor ' + rp.score + ')'); } catch (e) { log('profil risiko gagal: ' + e.message); }

      // Analisis AI hanya dibuat ulang bila ada berita baru, atau belum ada analisis format FAP, atau yang ada sudah > 24 jam (hemat token).
      const lastAna = doAnalysis ? await latestAnalysis(co.id).catch(() => null) : null;
      const anaFresh = lastAna && lastAna.verifikasi && Date.now() - new Date(lastAna.generatedAt).getTime() < 24 * 3600 * 1000;
      if (doAnalysis && anaFresh && (row.newItems || 0) === 0) {
        row.analysis = 'dilewati (tidak ada berita baru)';
        log('analisis AI dilewati: tidak ada berita baru dan analisis masih segar (< 24 jam)');
      } else if (doAnalysis) {
        try {
          const fin = co.type === 'public' && co.ticker ? await getFinancials(co.ticker).catch(() => null) : null;
          await saveAnalysis(co.id, await generateAnalysis(co, fin));
          row.analysis = 'dibuat';
          log('analisis AI dibuat');
        } catch (e) { row.analysis = 'gagal: ' + e.message; log(`analisis AI gagal: ${e.message}`); }
      }
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
    catch (e) { if (e.code === 'CANCELLED') throw e; rows.push({ company: co.ticker || co.id, status: 'error: ' + e.message }); log(co.name + ' gagal: ' + e.message); }
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

// Ambil gambar artikel (og:image) untuk berita yang belum punya.
export async function runImages(opts = {}, ctx = {}) {
  const rows = await forEachCompany(opts, ctx, 'ambil gambar artikel', async (co) => {
    const r = await enrichImages(co.id, 150);
    ctx.log?.('gambar ditemukan ' + r.found + ' dari ' + r.checked + ' artikel dicek');
    return { dicek: r.checked, ditemukan: r.found };
  });
  return finishSimple('images', rows, ctx);
}

// Buat ulang analisis AI semua perusahaan (data keuangan + berita 30 hari).
export async function runAnalysisAll(opts = {}, ctx = {}) {
  const delay = clamp(num(opts.delayMs, 3000), 0, 600_000);
  const rows = await forEachCompany(opts, ctx, 'analisis AI', async (co) => {
    const fin = co.type === 'public' && co.ticker ? await getFinancials(co.ticker).catch(() => null) : null;
    const a = await generateAnalysis(co, fin);
    await saveAnalysis(co.id, a);
    ctx.log?.('dibuat: ' + a.headline);
    await sleepAbortable(delay, ctx.signal);
    return { kondisi: a.kondisi, berita: a.newsCount };
  });
  return finishSimple('analysis', rows, ctx);
}

// Klasifikasi ulang berita yang AI-nya gagal/dilewati (mis. kuota Groq habis saat crawl).
export async function runReclassify(opts = {}, ctx = {}) {
  const chunk = clamp(num(opts.aiChunk, 60), 1, 200);
  const delay = clamp(num(opts.aiDelayMs, 3000), 0, 600_000);
  const rows = await forEachCompany(opts, ctx, 'klasifikasi ulang', async (co) => {
    const [todo] = await db().query(
      "SELECT url, title, snippet, source_name, source_domain, image_url, UNIX_TIMESTAMP(sort_at) AS ts FROM news_items WHERE company_id = ? AND content_kind <> 'konsumen' AND " + INCOMPLETE_SQL + " ORDER BY sort_at DESC LIMIT 300",
      [co.id],
    );
    ctx.log?.(todo.length + ' berita belum terklasifikasi');
    let ok = 0, bad = 0;
    for (let i = 0; i < todo.length; i += chunk) {
      throwIfAborted(ctx.signal);
      const items = todo.slice(i, i + chunk).map((r, k) => ({
        id: k + 1, platform: r.source_name || r.source_domain || '', url: r.url, title: r.title, snippet: r.snippet,
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
  });
  return finishSimple('reclassify', rows, ctx);
}

// Hitung ulang tag risiko untuk semua berita tersimpan (aturan, tanpa AI, cepat). Dipakai setelah aturan risiko diubah.
export async function runRescore(opts = {}, ctx = {}) {
  const rows = await forEachCompany(opts, ctx, 'hitung ulang keterkaitan & tag risiko', async (co) => {
    const match = buildMatcher(co);
    const [items] = await db().query('SELECT id, title, snippet, url, source_domain, credibility_tier FROM news_items WHERE company_id = ?', [co.id]);
    let tagged = 0, related = 0, konsumen = 0;
    for (const it of items) {
      throwIfAborted(ctx.signal);
      const text = it.title + ' ' + (it.snippet || '');
      const tags = riskTags(text);
      const rel = match(text);
      if (tags.length) tagged++;
      if (rel.related) related++;
      let host = it.source_domain; try { host ||= new URL(it.url).hostname; } catch { /* host kosong */ }
      const platform = platformOf({ domain: host, tier: it.credibility_tier });
      const kind = contentKind({ title: it.title, snippet: it.snippet, tier: it.credibility_tier, platform });
      if (kind === 'konsumen') konsumen++;
      await db().query('UPDATE news_items SET risk_tags = ?, risk_level = ?, related = ?, related_via = ?, title_hash = ?, platform = ?, content_kind = ? WHERE id = ?',
        [tags.length ? JSON.stringify(tags) : null, maxSeverity(tags), rel.related ? 1 : 0, rel.via, createHash('sha1').update(normTitle(it.title)).digest(), platform, kind, it.id]);
    }
    ctx.log?.(items.length + ' berita mentah: ' + related + ' terkait (cleaned), ' + (items.length - related) + ' tidak terkait; ' + tagged + ' bertag risiko; ' + konsumen + ' konten tutorial/konsumen disaring');
    return { mentah: items.length, terkait: related, tidakTerkait: items.length - related, bertagRisiko: tagged, konsumenDisaring: konsumen };
  });
  return finishSimple('rescore', rows, ctx);
}

// Buang duplikat yang sudah terlanjur tersimpan: judul sama persis, lalu judul mirip (Jaccard > 0.8, jarak <= 14 hari).
// Yang dipertahankan: yang sudah dinilai AI, lalu yang punya gambar, lalu yang paling awal tersimpan.
export async function runDedupe(opts = {}, ctx = {}) {
  let totalDeleted = 0;
  const rows = await forEachCompany(opts, ctx, 'buang duplikat', async (co) => {
    const [items] = await db().query('SELECT id, title, ai_status, image_url, sort_at FROM news_items WHERE company_id = ?', [co.id]);
    const score = (r) => (r.ai_status === 'ok' ? 4 : 0) + (r.image_url ? 2 : 0);
    const ordered = [...items].sort((x, y) => score(y) - score(x) || x.id - y.id);
    const keptExact = new Map();
    const kept = [];
    const del = [];
    let exact = 0, near = 0;
    for (const r of ordered) {
      throwIfAborted(ctx.signal);
      const key = normTitle(r.title);
      if (keptExact.has(key)) { del.push(r.id); exact++; continue; }
      const tk = titleTokens(r.title);
      const t = new Date(r.sort_at).getTime();
      if (kept.some((k) => Math.abs(k.t - t) <= 14 * 86400000 && jaccard(tk, k.tk) > NEAR_DUP)) { del.push(r.id); near++; continue; }
      keptExact.set(key, true);
      kept.push({ tk, t });
    }
    for (let i = 0; i < del.length; i += 500) await db().query('DELETE FROM news_items WHERE id IN (?)', [del.slice(i, i + 500)]);
    totalDeleted += del.length;
    ctx.log?.(items.length + ' berita: ' + exact + ' duplikat persis dan ' + near + ' mirip dibuang, tersisa ' + (items.length - del.length));
    return { sebelum: items.length, duplikatPersis: exact, duplikatMirip: near, sesudah: items.length - del.length };
  });
  return finishSimple('dedupe', rows, ctx, { totalDibuang: totalDeleted });
}

// ─── Job manager (di memori, satu job aktif sekaligus) ─
const RUNNERS = { simulate: runSimulate, cron: runCron, portfolio: runPortfolio, images: runImages, analysis: runAnalysisAll, reclassify: runReclassify, rescore: runRescore, dedupe: runDedupe, financial: runFinancial };
const ACTIVE = new Set(['running', 'waiting']);
const JOBS = new Map();
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
    case 'reclassify': case 'analysis': return ['ai'];
    case 'images': case 'financial': return ['crawl'];
    case 'rescore': case 'dedupe': return ['db'];
    default: return ['crawl', 'ai'];            // simulate / cron
  }
}
const lanesConflict = (a, b) => a.includes('db') || b.includes('db') || a.some((l) => b.includes(l));

const MULTI = new Set(['portfolio', 'images', 'analysis', 'reclassify', 'rescore', 'dedupe', 'financial']);
export function publicJob(job) {
  const { _controller, ...rest } = job;
  const cp = job.checkpoint || { done: [], total: 0 };
  // Bisa dilanjutkan: job multi-perusahaan yang berhenti sebelum semua perusahaan selesai
  rest.lanes = job.lanes || lanesOf(job.type, job.opts);
  rest.resumable = MULTI.has(job.type) && ['interrupted', 'cancelled', 'error'].includes(job.status) && cp.total > 0 && cp.done.length < cp.total;
  return rest;
}

// Simpan status job ke DB (tahan restart). Kesalahan DB tidak boleh menghentikan job.
const persist = (job) => saveJobRun(job).catch((e) => console.error('[db] saveJobRun:', e.message));

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
  return startJob(old.type, { ...old.opts, skipCompanies: old.checkpoint.done }, { resumedFrom: old.id, done: old.checkpoint.done, total: old.checkpoint.total });
}

export function listJobs() {
  return [...JOBS.values()].sort((a, b) => b.createdAt - a.createdAt).map((j) => ({
    id: j.id, type: j.type, status: j.status, createdAt: j.createdAt, finishedAt: j.finishedAt, progress: j.progress,
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
    checkpoint: { done: [...(meta.done || [])], total: meta.total || 0 }, resumedFrom: meta.resumedFrom || null, lanes,
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
    checkpoint: ({ done, total }) => {
      if (total) job.checkpoint.total = total;
      if (done && !job.checkpoint.done.includes(done)) job.checkpoint.done.push(done);
      persist(job);
    },
  };

  if (note) ctx.log(note);
  runner(opts, ctx)
    .then(() => { job.status = controller.signal.aborted ? 'cancelled' : 'done'; })
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
