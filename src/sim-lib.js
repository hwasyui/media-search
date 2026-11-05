// Pustaka bersama untuk scripts/simulate.js & scripts/cron-crawl.js.
// Isinya: parser argumen, penyusun job, runner (nyata & palsu/dry), dan perhitungan metrik kualitas data.
import { ADAPTERS } from './sources/adapters.js';
import { listCompanies } from './store.js';
import { buildQuery, MODIFIERS } from './search.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Argumen CLI ───────────────────────────────────────
// --flag            -> true
// --key value       -> 'value'
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[k] = true;
    else { out[k] = next; i++; }
  }
  return out;
}

// Terima string "a,b,c" (CLI) maupun array (UI/API).
const list = (v) => (Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean)
  : typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

// Tentukan keyword, sumber, modifier, dan entitas (untuk konteks AI) dari argumen.
//   --company telkom      -> nama + alias + stakeholder dari tabel companies di DB (seperti tag-box di UI)
//   --keywords "a,b,c"    -> keyword manual
export async function resolveTargets(args) {
  const companies = await listCompanies();
  let keywords = list(args.keywords);
  const anchors = {};          // pemangku kepentingan -> nama perusahaan yang wajib ikut di query
  let entity = null;
  if (args.company) {
    entity = companies.find((c) => c.id === args.company);
    if (!entity) throw new Error(`company "${args.company}" tidak ada. Pilihan: ${companies.map((c) => c.id).join(', ')}`);
    const own = new Set([entity.name, ...(entity.aliases || [])].map((x) => x.toLowerCase()));
    const stk = (entity.stakeholders || []).map((s) => s.name).filter((n) => !own.has(n.toLowerCase()));
    keywords = [...new Set([entity.name, ...(entity.aliases || []), ...stk])];
    // Pemangku kepentingan dicari BERSAMA nama perusahaan (salah satu dari: alias, ticker, nama resmi tanpa PT/Tbk/Persero): hasil harus tentang hubungannya dengan perusahaan ini.
    const short = entity.name.replace(/\b(PT|CV|Tbk|Persero)\b|[()]/gi, ' ').replace(/\s+/g, ' ').trim();
    const anchor = [...new Set([...(entity.aliases || []), entity.ticker, short].filter((x) => x && x.length >= 3 && x !== entity.name))].slice(0, 5);
    for (const n of stk) anchors[n] = anchor;
  }
  if (!keywords.length) throw new Error('Isi --company <id> atau --keywords "a,b,c"');
  if (!entity) entity = { name: keywords[0], aliases: keywords.slice(1), sector: '-', stakeholders: [] };
  entity = { ...entity, keyword: keywords.join(', ') };

  const allSources = Object.keys(ADAPTERS).filter((k) => !ADAPTERS[k].disabled);
  const sources = list(args.sources).length ? list(args.sources) : allSources;
  const bad = sources.filter((s) => !ADAPTERS[s]);
  if (bad.length) throw new Error(`sumber tidak dikenal: ${bad.join(', ')}. Pilihan: ${allSources.join(', ')}`);
  const modifiers = list(args.modifiers).length ? list(args.modifiers) : ['none'];
  const badMod = modifiers.filter((m) => !MODIFIERS[m]);
  if (badMod.length) throw new Error(`modifier tidak dikenal: ${badMod.join(', ')}. Pilihan: ${Object.keys(MODIFIERS).join(', ')}`);
  return { keywords, sources, modifiers, entity, anchors, extraQueries: args.company ? (entity.extraQueries || []) : [] };
}

// Modifier topik khusus (akta, klien, kredit, hukum) hanya bermakna untuk pencarian berita; YouTube dan media sosial tidak diberi query itu.
const NEWS_ONLY_MODS = new Set(['deed', 'klien', 'kredit', 'hukum']);
const NEWS_SOURCES = new Set(['google_news', 'bing_news']);

export function buildJobs(keywords, sources, modifiers = ['none'], anchors = {}, extraQueries = []) {
  const jobs = [];
  // Query tambahan dari analis dipakai apa adanya (tanpa modifier) di tiap sumber
  for (const q of extraQueries) for (const source of sources) jobs.push({ keyword: q, source, modifier: 'none', q });
  for (const keyword of keywords)
    for (const source of sources)
      for (const modifier of modifiers) {
        if (NEWS_ONLY_MODS.has(modifier) && !NEWS_SOURCES.has(source)) continue;
        jobs.push({ keyword, source, modifier, q: buildQuery(keyword, modifier, anchors[keyword]) });
      }
  return jobs;
}

// ─── Runner nyata ──────────────────────────────────────
// Menjalankan job lewat adapter asli dengan worker pool (seperti runSearch) tapi mencatat waktu & error per job.
// signal: AbortSignal untuk membatalkan di sela job. onJob(n): dipanggil tiap job selesai (untuk progress bar).
export async function runJobs(jobs, { concurrency = 3, signal, onJob } = {}) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < jobs.length && !signal?.aborted) {
      const job = jobs[idx++];
      const t0 = Date.now();
      try {
        const items = await ADAPTERS[job.source].run(job.q);
        results.push({ job, ok: true, ms: Date.now() - t0, items: items.map((it) => ({ ...it, keyword: job.keyword, sourceKey: job.source, modifier: job.modifier, query: job.q })) });
      } catch (e) {
        results.push({ job, ok: false, ms: Date.now() - t0, error: e.message, items: [] });
      }
      onJob?.(results.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) || 1 }, worker));
  return results;
}

// ─── Runner palsu (mode --dry) ─────────────────────────
// Menghasilkan data sintetis TANPA request jaringan, untuk mensimulasikan volume besar dengan aman.
// Waktu yang dilaporkan adalah waktu simulasi (tidak benar-benar di-sleep).
export function makeFakeRunner({ latency = [300, 2500], failRate = 0.05, itemsPerJob = [0, 40], dupRate = 0.15, spamRate = 0.03 } = {}) {
  const rnd = (a, b) => a + Math.random() * (b - a);
  const domains = ['detik.com', 'kompas.com', 'cnbcindonesia.com', 'tempo.co', 'instagram.com', 'x.com', 'facebook.com', 'youtube.com', 'kontan.co.id', 'idx.co.id'];
  const topics = ['laba bersih naik', 'diduga korupsi pengadaan', 'sanksi OJK', 'ekspansi bisnis baru', 'keluhan pelanggan', 'buyback saham', 'katanya akan ada PHK', 'penghargaan inovasi'];
  const seenUrls = [];
  let n = 0;
  return async function fakeRunJobs(jobs, { concurrency = 3 } = {}) {
    return jobs.map((job) => {
      const ms = Math.round(rnd(...latency));
      if (Math.random() < failRate) return { job, ok: false, ms, error: 'fetch failed (simulasi)', items: [] };
      const count = Math.round(rnd(...itemsPerJob));
      const items = Array.from({ length: count }, () => {
        n++;
        const isDup = seenUrls.length && Math.random() < dupRate;
        const url = isDup ? `${seenUrls[Math.floor(Math.random() * seenUrls.length)]}?utm_source=sim` : `https://www.${domains[n % domains.length]}/artikel/${n}`;
        if (!isDup) seenUrls.push(url);
        const spam = Math.random() < spamRate;
        return {
          title: `${job.keyword} ${topics[n % topics.length]} (${n})`,
          url,
          snippet: spam ? 'slot gacor bonus new member daftar sekarang' : `Laporan terbaru mengenai ${job.keyword}: ${topics[(n + 3) % topics.length]} dan perkembangannya pekan ini.`,
          date: new Date(Date.now() - Math.random() * 9 * 864e5).toISOString(),
          sourceName: job.source,
          keyword: job.keyword,
          sourceKey: job.source,
        };
      });
      return { job, ok: true, ms, items };
    });
  };
}

// Perkiraan waktu dinding satu chunk: total latensi dibagi jumlah worker paralel.
export const estimateChunkMs = (results, concurrency) => Math.round(results.reduce((s, r) => s + r.ms, 0) / Math.max(1, concurrency));

// ─── Metrik ────────────────────────────────────────────
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const avg = (xs) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0);

// "Seberapa bagus diambil": keberhasilan fetch per sumber.
export function summarizeFetch(results) {
  const bySource = {};
  for (const r of results) {
    const s = (bySource[r.job.source] ||= { jobs: 0, failed: 0, empty: 0, items: 0, ms: [], errors: {} });
    s.jobs++;
    s.items += r.items.length;
    s.ms.push(r.ms);
    if (!r.ok) { s.failed++; s.errors[r.error] = (s.errors[r.error] || 0) + 1; }
    else if (!r.items.length) s.empty++;
  }
  return Object.fromEntries(Object.entries(bySource).map(([k, s]) => [k, {
    jobs: s.jobs,
    failed: s.failed,
    failRatePct: pct(s.failed, s.jobs),
    emptyPct: pct(s.empty, s.jobs),
    items: s.items,
    avgItemsPerJob: Math.round((s.items / s.jobs) * 10) / 10,
    avgMs: avg(s.ms),
    maxMs: Math.max(...s.ms),
    topErrors: Object.entries(s.errors).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, c]) => `${c}x ${m}`),
  }]));
}

// "Seberapa valid": kelengkapan & kesegaran data mentah sebelum dibersihkan.
export function summarizeRawQuality(items, maxAgeDays = 7) {
  const cutoff = Date.now() - maxAgeDays * 864e5;
  const validUrl = (u) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };
  let title = 0, url = 0, snippet = 0, dated = 0, fresh = 0;
  const domains = new Set();
  for (const it of items) {
    if ((it.title || '').trim().length >= 5) title++;
    if (validUrl(it.url)) { url++; try { domains.add(new URL(it.url).hostname.replace(/^www\./, '')); } catch { /* abaikan */ } }
    if ((it.snippet || '').trim().length >= 20) snippet++;
    const t = it.date ? Date.parse(it.date) : NaN;
    if (!Number.isNaN(t)) { dated++; if (t >= cutoff) fresh++; }
  }
  const n = items.length;
  return {
    total: n,
    withTitlePct: pct(title, n),
    withValidUrlPct: pct(url, n),
    withSnippetPct: pct(snippet, n),
    withDatePct: pct(dated, n),
    freshWithinDaysPct: pct(fresh, n),
    freshDays: maxAgeDays,
    uniqueDomains: domains.size,
  };
}

// Hasil pembersihan: berapa persen data yang benar-benar layak pakai.
export function summarizeClean(stats) {
  return {
    ...stats,
    usablePct: pct(stats.output, stats.input),
    duplicatePct: pct(stats.duplicate, stats.input),
    spamPct: pct(stats.spam, stats.input),
    invalidPct: pct(stats.invalid, stats.input),
  };
}

// Distribusi hasil AI + bagian non-AI (credibility, impact).
export function summarizeAi(classified) {
  const count = (fn) => classified.reduce((m, it) => { const k = fn(it) ?? '-'; m[k] = (m[k] || 0) + 1; return m; }, {});
  const ok = classified.filter((it) => !it.ai.error);
  const relevant = ok.filter((it) => it.ai.relevant);
  const errors = {};
  classified.filter((it) => it.ai.error).forEach((it) => { errors[it.ai.error] = (errors[it.ai.error] || 0) + 1; });
  return {
    total: classified.length,
    aiOk: ok.length,
    aiFailed: classified.length - ok.length,
    aiFailedPct: pct(classified.length - ok.length, classified.length),
    relevantPct: pct(relevant.length, ok.length),
    avgConfidence: ok.length ? Math.round((ok.reduce((s, it) => s + (it.ai.confidence || 0), 0) / ok.length) * 100) / 100 : 0,
    category: count((it) => (it.ai.error ? 'error' : it.ai.category)),
    impact_nonAI: count((it) => it.ai.impact),
    credibility_nonAI: count((it) => it.credibility?.key),
    withRiskSignals: ok.filter((it) => (it.ai.risk_signals || []).length).length,
    topErrors: Object.entries(errors).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, c]) => `${c}x ${m}`),
  };
}

// Peringatan sederhana supaya hasil simulasi langsung terbaca "sehat / tidak".
export function healthFlags({ fetch, raw, clean, ai }) {
  const flags = [];
  for (const [src, s] of Object.entries(fetch || {})) {
    if (s.failRatePct >= 30) flags.push(`sumber ${src}: ${s.failRatePct}% query gagal`);
    if (s.jobs >= 3 && s.items === 0 && s.failed < s.jobs) flags.push(`sumber ${src}: tidak menghasilkan item sama sekali`);
  }
  if (raw && raw.total && raw.withDatePct < 60) flags.push(`hanya ${raw.withDatePct}% item punya tanggal valid`);
  if (raw && raw.total && raw.freshWithinDaysPct < 50) flags.push(`hanya ${raw.freshWithinDaysPct}% item dalam ${raw.freshDays} hari terakhir`);
  if (clean && clean.input && clean.usablePct < 60) flags.push(`hanya ${clean.usablePct}% data lolos pembersihan`);
  if (ai && ai.total && ai.aiFailedPct >= 10) flags.push(`${ai.aiFailedPct}% item gagal diklasifikasi AI`);
  return flags;
}

export function printSection(title, obj) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(2, 60 - title.length))}`);
  console.log(JSON.stringify(obj, null, 2));
}
