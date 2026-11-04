// CLI cron crawl: splitter + berurutan + jeda. Logika ada di src/jobs.js (dipakai juga oleh tombol di /jobs.html).
//
//   semua job (keyword x sumber x modifier) -> dipecah per --chunk-size
//   work1 --jeda--> work2 --jeda--> work3 ... (berurutan, bukan serentak)
//   -> clean (dedup lintas chunk) -> klasifikasi AI juga dipecah per --ai-chunk dengan jeda
//
//   npm run cron-crawl -- --company telkom --chunk-size 6 --delay-ms 15000
//   npm run cron-crawl -- --company telkom --dry --fake-jobs 600 --chunk-size 20 --delay-ms 20000
//   npm run cron-crawl -- --company telkom --classify --every-min 60     (mode cron: ulangi tiap 60 menit)
//
// Opsi: --sources a,b  --modifiers none,isu  --concurrency 3  --chunk-size 6  --delay-ms 15000
//       --classify  --ai-chunk 60  --ai-delay-ms 3000  --every-min N  --max-cycles N  --dry  --fake-jobs N
import { parseArgs, printSection } from '../src/sim-lib.js';
import { runCron } from '../src/jobs.js';

const args = parseArgs(process.argv.slice(2));
const opts = {
  company: args.company, keywords: args.keywords, sources: args.sources, modifiers: args.modifiers,
  classify: Boolean(args.classify), dry: Boolean(args.dry),
  concurrency: args.concurrency, chunkSize: args['chunk-size'], delayMs: args['delay-ms'],
  aiChunk: args['ai-chunk'], aiDelayMs: args['ai-delay-ms'], everyMin: args['every-min'],
  maxCycles: args['max-cycles'], fakeJobs: args['fake-jobs'], maxAgeDays: args['max-age-days'],
};

process.on('SIGINT', () => { console.log('\n[cron-crawl] dihentikan.'); process.exit(0); });

await runCron(opts, {
  log: (m) => console.log(`[cron-crawl] ${m}`),
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
