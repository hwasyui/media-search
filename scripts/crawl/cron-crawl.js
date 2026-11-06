// CLI cron crawl. Logika ada di src/jobs/jobs.js (dipakai juga oleh tombol di /jobs).
//
// Dua mode:
//  1) --company <id> (mode lengkap, urutan langkah SAMA dengan crawl portofolio di Task Runner), per siklus:
//       data keuangan (emiten) -> crawl terpecah (work1 --jeda--> work2 ...) -> clean -> isi & gambar artikel -> simpan
//       -> [dengan --classify] klasifikasi AI -> rating risiko -> analisis AI -> dossier
//     Tanpa --classify, langkah AI (klasifikasi/analisis/dossier) dilewati dan hanya data mentah yang disimpan.
//     Bila satu langkah gagal (mis. model AI sibuk), siklus itu dicatat gagal; siklus berikutnya tetap jalan (mode --every-min).
//  2) tanpa --company (mode kata kunci, lama): --keywords a,b lalu dipecah dan dijalankan berurutan (tanpa isi artikel/analisis/dossier).
//
//   npm run cron-crawl -- --company telkom --chunk-size 6 --delay-ms 15000
//   npm run cron-crawl -- --company telkom --classify --every-min 60     (mode cron: ulangi tiap 60 menit)
//   npm run cron-crawl -- --keywords "telkom,indosat" --dry --fake-jobs 600 --chunk-size 20 --delay-ms 20000
//
// Opsi: --sources a,b  --modifiers none,isu  --concurrency 3  --chunk-size 6  --delay-ms 15000
//       --classify  --ai-chunk 60  --ai-delay-ms 3000  --every-min N  --max-cycles N  --dry  --fake-jobs N
import { parseArgs, printSection } from '../../src/jobs/sim-lib.js';
import { runCron, runPortfolio } from '../../src/jobs/jobs.js';

const args = parseArgs(process.argv.slice(2));
const csv = (v) => (typeof v === 'string' && v ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
const opts = {
  company: args.company, keywords: args.keywords, sources: args.sources, modifiers: args.modifiers,
  classify: Boolean(args.classify), dry: Boolean(args.dry),
  concurrency: args.concurrency, chunkSize: args['chunk-size'], delayMs: args['delay-ms'],
  aiChunk: args['ai-chunk'], aiDelayMs: args['ai-delay-ms'], everyMin: args['every-min'],
  maxCycles: args['max-cycles'], fakeJobs: args['fake-jobs'], maxAgeDays: args['max-age-days'],
};
const log = (m) => console.log(`[cron-crawl] ${m}`);

process.on('SIGINT', () => { console.log('\n[cron-crawl] dihentikan.'); process.exit(0); });

if (opts.company && !opts.dry && !opts.fakeJobs && !opts.keywords) {
  // Mode lengkap: sama persis dengan crawl portofolio satu perusahaan
  const everyMs = Math.max(0, Number(opts.everyMin) || 0) * 60_000;
  const maxCycles = everyMs ? Math.max(1, Number(opts.maxCycles) || 1_000_000) : 1;
  const popts = {
    companies: [String(opts.company)], classify: opts.classify, companyDelayMs: 0,
    sources: csv(opts.sources), modifiers: csv(opts.modifiers),
    chunkSize: opts.chunkSize, delayMs: opts.delayMs, concurrency: opts.concurrency, aiChunk: opts.aiChunk, aiDelayMs: opts.aiDelayMs, maxAgeDays: opts.maxAgeDays,
  };
  let failed = 0;
  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    log(`siklus ${cycle}${everyMs ? '' : ' (sekali jalan)'}`);
    try {
      const r = (await runPortfolio(popts, { log }))?.[0];
      const bad = (r?.perWork || []).filter((w) => w.status !== 'ok');
      printSection(`Siklus ${cycle}: ringkasan`, r?.perWork || []);
      if (bad.length) { failed++; log(`siklus ${cycle} sebagian gagal: ${bad.map((b) => b.status).join('; ')}`); }
    } catch (e) {
      failed++; log(`siklus ${cycle} gagal: ${e.message}`);
      if (!everyMs) { process.exitCode = 1; break; }       // sekali jalan: gagal = keluar dengan kode error; mode cron: lanjut ke siklus berikutnya
    }
    if (!everyMs || cycle >= maxCycles) break;
    log(`menunggu ${opts.everyMin} menit sebelum siklus ${cycle + 1}`);
    await new Promise((res) => setTimeout(res, everyMs));
  }
  if (failed && !process.exitCode) process.exitCode = 1;
} else {
  // Mode kata kunci / simulasi (lama)
  await runCron(opts, {
    log,
    onReport: (report) => {
      printSection(`Cycle ${report.cycle}: ringkasan per work`, report.perWork);
      printSection('Fetch per sumber', report.fetch);
      printSection('Kualitas data mentah', report.raw);
      printSection('Hasil pembersihan', report.clean);
      if (report.ai) printSection('Klasifikasi AI + komponen non-AI', report.ai);
      if (report.aiProjection) printSection('Proyeksi tahap AI', report.aiProjection);
      printSection('Waktu', report.timing);
      console.log(report.health.length ? report.health.map((f) => `⚠ ${f}`).join('\n') : '✓ Tidak ada peringatan.');
    },
  });
}
