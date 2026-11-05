// ============================================================================================================================
// BACKUP - TIDAK DIPAKAI LAGI. Fitur "simulate" (simulasi kualitas data sekali jalan) dinonaktifkan untuk sementara: dicabut dari src/jobs.js (RUNNERS),
// dari npm scripts, dan dari Task Runner. File ini hanya arsip (bagian 1 = fungsi runSimulate dari src/jobs.js, bagian 2 = skrip CLI scripts/simulate.js).
// Tidak di-import dan tidak dipanggil di mana pun. Untuk mengaktifkan lagi: kembalikan fungsi ke src/jobs.js, daftarkan di RUNNERS, dan pindahkan skripnya ke scripts/.
// ============================================================================================================================

// ───────────── BAGIAN 1: runSimulate (dulu di src/jobs.js) ─────────────
// // ─── Simulasi kualitas data (sekali jalan) ─────────────
// // opts: { company | keywords, sources, modifiers, classify, dry, concurrency, maxAgeDays }
// export async function runSimulate(opts = {}, ctx = {}) {
//   const log = ctx.log || (() => {});
//   const progress = ctx.progress || (() => {});
//   const concurrency = clamp(num(opts.concurrency, 3), 1, 6);
//   const maxAgeDays = clamp(num(opts.maxAgeDays, 7), 1, 60);
//   const dry = Boolean(opts.dry);
//
//   const { keywords, sources, modifiers, entity } = await resolveTargets(opts);
//   const jobs = buildJobs(keywords, sources, modifiers);
//   if (!dry && jobs.length > MAX_REAL_JOBS) throw new Error(`Terlalu banyak query (${jobs.length}); maksimal ${MAX_REAL_JOBS} untuk run nyata.`);
//   log(`${keywords.length} keyword x ${sources.length} sumber x ${modifiers.length} modifier = ${jobs.length} query${dry ? ' (DRY: data sintetis)' : ''}`);
//
//   const t0 = Date.now();
//   progress({ stage: 'fetch', done: 0, total: jobs.length });
//   const run = dry ? makeFakeRunner() : runJobs;
//   const results = await run(jobs, { concurrency, signal: ctx.signal, onJob: (n) => progress({ stage: 'fetch', done: n, total: jobs.length }) });
//   throwIfAborted(ctx.signal);
//   const fetchMs = Date.now() - t0;
//
//   const rawItems = results.flatMap((r) => r.items);
//   const failed = results.filter((r) => !r.ok).length;
//   log(`fetch selesai: ${rawItems.length} item mentah, ${failed}/${jobs.length} query gagal, ${fetchMs}ms`);
//
//   const report = {
//     type: 'simulate',
//     createdAt: new Date().toISOString(),
//     config: { keywords, sources, modifiers, jobs: jobs.length, dry, concurrency },
//     fetch: summarizeFetch(results),
//     raw: summarizeRawQuality(rawItems, maxAgeDays),
//   };
//
//   // Perusahaan terbuka: cek juga seberapa lengkap data keuangan publiknya (non-AI)
//   if (!dry && entity.type === 'public' && entity.ticker) {
//     log(`data keuangan ${entity.ticker}...`);
//     try {
//       const f = await getFinancials(entity.ticker);
//       const q = f.fundamentals?.quarterly?.[0];
//       report.financial = {
//         ticker: f.ticker,
//         harga: f.price ? `${f.price.price} ${f.price.currency} (5h ${f.price.change5dPct}%, 1b ${f.price.change1mPct}%)` : 'GAGAL',
//         valuasi: f.valuation ? 'ok' : 'GAGAL',
//         laporanKeuangan: f.fundamentals ? `${f.fundamentals.quarterly.length} kuartal, ${f.fundamentals.annual.length} tahun (terakhir ${q?.asOf || '-'}, ${f.fundamentals.currency || '?'})` : 'GAGAL',
//         pengumumanIdx: f.announcements ? `${f.announcements.length} dalam 90 hari` : `tidak tersedia: ${f.errors.announcements}`,
//         sinyal: f.signals.length ? f.signals.map((x) => `[${x.level}] ${x.text}`) : 'tidak ada',
//         error: Object.entries(f.errors).map(([k, v]) => `${k}: ${v}`).join('; ') || 'tidak ada',
//       };
//     } catch (e) {
//       report.financial = { ticker: entity.ticker, error: e.message };
//     }
//   }
//
//   progress({ stage: 'clean', done: 0, total: 1 });
//   const cleaned = cleanItems(rawItems);
//   report.clean = summarizeClean(cleaned.stats);
//   log(`clean: ${cleaned.stats.output}/${cleaned.stats.input} lolos (${report.clean.usablePct}%)`);
//
//   if (!dry && cleaned.items.length) {
//     log(`ekstraksi konten: mengambil isi artikel & caption sosmed (${cleaned.items.length} item)...`);
//     await prepareContent(entity?.id, cleaned.items, { concurrency: 6, signal: ctx.signal, log, onProgress: (d, tot) => progress({ stage: 'extract', done: d, total: tot }) });
//     log(`ekstraksi selesai: konten lengkap & caption siap`);
//   }
//
//   const droppedDup = !dry ? await persistItems(entity, cleaned.items, null, report, log) : new Set();     // berita langsung tersimpan sebelum AI jalan
//
//   if (opts.classify) {
//     if (dry) {
//       log('klasifikasi AI dilewati pada mode DRY (tidak memanggil Groq).');
//     } else {
//       const sp = entity?.id ? await splitComplete(entity.id, cleaned.items.filter((it) => !droppedDup.has(it.url))) : { todo: cleaned.items, complete: [] };
//       if (sp.complete.length) { log(`${sp.complete.length} berita sudah terklasifikasi lengkap: dilewati`); report.aiSkippedComplete = sp.complete.length; }
//       const items = sp.todo.slice(0, MAX_ITEMS);
//       log(`klasifikasi AI ${items.length} item dengan ${groqKeys().length} key Groq + ${geminiKeys().length} Gemini`);
//       const classified = [];
//       const step = BATCH * 3;
//       for (let i = 0; i < items.length; i += step) {
//         throwIfAborted(ctx.signal);
//         const out = await classifyItems(items.slice(i, i + step), entity);
//         classified.push(...out);
//         if (entity?.id) await saveNews(entity.id, out, { dedupe: false });        // perbarui per batch: tidak hilang bila job berhenti
//         progress({ stage: 'ai', done: Math.min(i + step, items.length), total: items.length });
//       }
//       report.ai = summarizeAi(classified);
//       log(`AI selesai: ${report.ai.aiOk} ok, ${report.ai.aiFailed} gagal`);
//     }
//   }
//
//   report.timing = { fetchMs, totalMs: Date.now() - t0 };
//   report.health = healthFlags(report);
//   report.file = await saveReport('simulate', report, entity.id);
//   log(`laporan disimpan ke DB: ${report.file}`);
//   ctx.onReport?.(report);
//   return [report];
// }
//
//

// ───────────── BAGIAN 2: scripts/simulate.js ─────────────
// // CLI simulasi kualitas data. Logika ada di src/jobs.js (dipakai juga oleh tombol di halaman /jobs.html).
// //
// //   npm run simulate -- --company telkom
// //   npm run simulate -- --keywords "Telkom,TLKM" --sources google_news,bing_news,youtube
// //   npm run simulate -- --company telkom --classify          (ikut memanggil Groq)
// //   npm run simulate -- --company telkom --dry               (data sintetis, tanpa jaringan)
// //
// // Opsi: --sources a,b  --modifiers none,isu  --concurrency 3  --max-age-days 7
// import { parseArgs, printSection } from '../src/sim-lib.js';
// import { runSimulate } from '../src/jobs.js';
//
// const args = parseArgs(process.argv.slice(2));
// const opts = {
//   company: args.company, keywords: args.keywords, sources: args.sources, modifiers: args.modifiers,
//   classify: Boolean(args.classify), dry: Boolean(args.dry),
//   concurrency: args.concurrency, maxAgeDays: args['max-age-days'],
// };
//
// const [report] = await runSimulate(opts, { log: (m) => console.log(`[simulate] ${m}`) });
//
// printSection('Fetch per sumber (seberapa bagus diambil)', report.fetch);
// printSection('Kualitas data mentah', report.raw);
// if (report.financial) printSection('Data keuangan (perusahaan terbuka)', report.financial);
// printSection('Hasil pembersihan (seberapa valid)', report.clean);
// if (report.ai) printSection('Klasifikasi AI + komponen non-AI', report.ai);
// printSection('Waktu', report.timing);
// console.log(`\n── Kesimpulan ${'─'.repeat(48)}`);
// console.log(report.health.length ? report.health.map((f) => `⚠ ${f}`).join('\n') : '✓ Tidak ada peringatan.');
//
