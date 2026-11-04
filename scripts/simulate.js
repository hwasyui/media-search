// CLI simulasi kualitas data. Logika ada di src/jobs.js (dipakai juga oleh tombol di halaman /jobs.html).
//
//   npm run simulate -- --company telkom
//   npm run simulate -- --keywords "Telkom,TLKM" --sources google_news,bing_news,youtube
//   npm run simulate -- --company telkom --classify          (ikut memanggil Groq)
//   npm run simulate -- --company telkom --dry               (data sintetis, tanpa jaringan)
//
// Opsi: --sources a,b  --modifiers none,isu  --concurrency 3  --max-age-days 7
import { parseArgs, printSection } from '../src/sim-lib.js';
import { runSimulate } from '../src/jobs.js';

const args = parseArgs(process.argv.slice(2));
const opts = {
  company: args.company, keywords: args.keywords, sources: args.sources, modifiers: args.modifiers,
  classify: Boolean(args.classify), dry: Boolean(args.dry),
  concurrency: args.concurrency, maxAgeDays: args['max-age-days'],
};

const [report] = await runSimulate(opts, { log: (m) => console.log(`[simulate] ${m}`) });

printSection('Fetch per sumber (seberapa bagus diambil)', report.fetch);
printSection('Kualitas data mentah', report.raw);
if (report.financial) printSection('Data keuangan (perusahaan terbuka)', report.financial);
printSection('Hasil pembersihan (seberapa valid)', report.clean);
if (report.ai) printSection('Klasifikasi AI + komponen non-AI', report.ai);
printSection('Waktu', report.timing);
console.log(`\n── Kesimpulan ${'─'.repeat(48)}`);
console.log(report.health.length ? report.health.map((f) => `⚠ ${f}`).join('\n') : '✓ Tidak ada peringatan.');
