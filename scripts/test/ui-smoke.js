// Penyisiran UI di Chromium sungguhan (Playwright): membuka semua halaman, tab, filter, urutan, modal, lalu melaporkan JS error dan permintaan gagal.
// Pakai:  node scripts/test/ui-smoke.js http://localhost:3062   (server harus menyala; butuh: npx playwright install chromium)
import { chromium } from 'playwright';

const BASE = process.argv[2];
const b = await chromium.launch();
const pg = await (await b.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
const errs = [], bad = [], steps = [];
pg.on('pageerror', (e) => errs.push(String(e)));
pg.on('console', (m) => { if (m.type() === 'error') errs.push(`console.error: ${m.text()}`); });
pg.on('response', (r) => {
  if (r.status() >= 400 && !r.url().includes('favicon') && !r.url().includes('google.com/s2')) bad.push(`${r.status()} ${r.url().replace(BASE, '')}`);
});
// jendela asisten dan tur tidak boleh menutupi halaman saat disapu
await pg.addInitScript("sessionStorage.setItem('ms.asst.seen','1'); localStorage.setItem('ms.asst.open','false'); localStorage.setItem('ms.tour','\"no\"');");
const ok = (name) => steps.push(name);

for (const url of ['/', '/c/bca', '/c/freeport', '/c/gotoyoy', '/c/pertamina', '/jobs', '/help', '/diagnose']) {
  await pg.goto(BASE + url); await pg.waitForTimeout(2200);
  if (url.startsWith('/c/')) {
    for (const t of ['risiko', 'dossier', 'keuangan', 'berita', 'profil', 'ringkasan']) {
      const el = await pg.$(`[data-t="${t}"]`);
      if (el) { await el.click(); await pg.waitForTimeout(1300); }
    }
  }
  ok(url);
}

// beranda: tiap urutan, filter lanjutan, pill, pencarian, modal berita, tambah perusahaan
await pg.goto(`${BASE}/`); await pg.waitForTimeout(2500);
for (const s of ['latest', 'oldest', 'risk', 'credibility', 'seen', 'mix']) { await pg.selectOption('#fsort', s); await pg.waitForTimeout(700); }
for (const d of ['7', '90', '0', '30']) { await pg.selectOption('#fdays', d); await pg.waitForTimeout(600); }
await pg.click('#fadv'); await pg.waitForTimeout(300);
for (const sid of await pg.evaluate("[...document.querySelectorAll('#fpanel select')].map(e => e.id)")) {
  const opts = await pg.evaluate((id) => [...document.getElementById(id).options].map((o) => o.value).filter(Boolean), sid);
  if (opts.length) { await pg.selectOption(`#${sid}`, opts[0]); await pg.waitForTimeout(600); await pg.selectOption(`#${sid}`, ''); await pg.waitForTimeout(500); }
}
const pill = await pg.$('#fpanel .pill');
if (pill) { await pill.click(); await pg.waitForTimeout(700); const reset = await pg.$('#freset'); if (reset) { await reset.click(); await pg.waitForTimeout(700); } }
await pg.fill('#fq', 'saham'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(1200);
const more = await pg.$('#fmore'); if (more) { await more.click(); await pg.waitForTimeout(1200); }
const a = await pg.$('#exploreMount .news');
if (a) { await a.click(); await pg.waitForTimeout(1500); if (!(await pg.isVisible('#nwModal'))) errs.push('modal berita tidak terbuka saat kartu diklik'); await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); if (await pg.isVisible('#nwModal')) errs.push('modal berita tidak tertutup dengan Escape'); }
await pg.click('#addCo'); await pg.waitForTimeout(200); if (!(await pg.isVisible('#acModal'))) errs.push('modal tambah perusahaan tidak terbuka'); await pg.click('#acClose');
await pg.fill('#q', 'bca'); await pg.waitForTimeout(1500); if (!(await pg.isVisible('#sugg.open'))) errs.push('saran pencarian tidak muncul'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(800);

// navigasi sidebar & tautan lama
await pg.goto(`${BASE}/portal.html#/c/bca`); await pg.waitForTimeout(2500);
if (!pg.url().endsWith('/c/bca')) errs.push('tautan lama /portal.html#/c/bca tidak diarahkan ke /c/bca (url: ' + pg.url() + ')');
await pg.goto(`${BASE}/help.html#rating`); await pg.waitForTimeout(800);
if (!pg.url().endsWith('/help#rating')) errs.push('tautan lama /help.html#rating tidak diarahkan (url: ' + pg.url() + ')');

const uniq = (x) => [...new Set(x)].sort();
console.log('halaman & interaksi disapu:', steps.join(' '), '| permintaan gagal (>=400):', uniq(bad).length ? uniq(bad) : 'tidak ada');
console.log('error JS/console:', uniq(errs).length ? uniq(errs).slice(0, 8) : 'tidak ada');
await b.close();
