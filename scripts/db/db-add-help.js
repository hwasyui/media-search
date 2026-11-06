// Sinkronkan isi halaman Bantuan (src/app/(app)/help/page.tsx) ke tabel app_help, supaya asisten AI bisa menjawab pertanyaan tentang aplikasi lewat alat MCP bantuan_aplikasi.
// page.tsx tetap satu-satunya sumber; jalankan ulang skrip ini setiap habis mengedit Bantuan (aman diulang: isi tabel diganti seluruhnya dalam satu transaksi).
//   node --env-file=.env scripts/db/db-add-help.js
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbAdmin } from '../../src/db/db.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(path.join(ROOT, 'src', 'app', '(app)', 'help', 'page.tsx'), 'utf8');
const art = html.slice(html.indexOf('<article>'), html.indexOf('</article>'));
const MAX = 1100;                         // batas karakter per baris (hasil alat dipotong 7000 karakter per panggilan, dan satu panggilan memuat sampai 6 baris)

const dec = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
const txt = (s) => dec(s
  .replace(/<sup>(.*?)<\/sup>/g, '^$1')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/t[dh]>/gi, ' | ').replace(/<\/tr>/gi, '\n')
  .replace(/<li>/gi, '\n- ')
  .replace(/<\/(p|div|ol|ul|dd|dt|h3)>|<div[^>]*>|<p[^>]*>/gi, '\n')
  .replace(/<[^>]+>/g, ' '))
  .replace(/[ \t]+/g, ' ').replace(/ \| \n/g, '\n').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();

const rows = [];
let sort = 0;
const add = (anchor, title, body) => {
  const text = txt(body);
  if (text.length < 20) return;
  // teks panjang dipecah per baris teks menjadi beberapa baris tabel
  let part = 1, cur = '';
  for (const line of text.split('\n')) {
    if (cur && (cur + '\n' + line).length > MAX) { rows.push([anchor, part > 1 ? title + ' (' + part + ')' : title, cur, ++sort]); part++; cur = ''; }
    cur = cur ? cur + '\n' + line : line.slice(0, MAX);
  }
  if (cur) rows.push([anchor, part > 1 ? title + ' (' + part + ')' : title, cur, ++sort]);
};

const heads = [...art.matchAll(/<h2 id="([^"]+)">(.*?)<\/h2>/g)];
heads.forEach((h, i) => {
  const id = h[1], h2 = txt(h[2]);
  let body = art.slice(h.index + h[0].length, i + 1 < heads.length ? heads[i + 1].index : art.length);
  // daftar istilah (dt/dd) dan tanya jawab (details/summary): satu baris per entri
  for (const m of body.matchAll(/<dt>(.*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)) add(id, h2 + ' — ' + txt(m[1]), m[2]);
  for (const m of body.matchAll(/<details><summary>(.*?)<\/summary><div>([\s\S]*?)<\/div><\/details>/g)) add(id, h2 + ' — ' + txt(m[1]), m[2]);
  body = body.replace(/<dl[\s\S]*?<\/dl>/g, '').replace(/<details>[\s\S]*?<\/details>/g, '');
  // sisanya: per sub-judul (h3); bagian sebelum h3 pertama = ringkasan bagian
  const parts = body.split(/<h3>(.*?)<\/h3>/);
  add(id, h2 + ' — ringkasan', parts[0]);
  for (let k = 1; k < parts.length; k += 2) add(id, h2 + ' — ' + txt(parts[k]), parts[k + 1] || '');
});
if (!rows.length) throw new Error('tidak ada isi yang terbaca dari src/app/(app)/help/page.tsx (struktur berubah?)');

const conn = await dbAdmin();
await conn.query('USE `media-search`');
await conn.query(`CREATE TABLE IF NOT EXISTS app_help (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  anchor     VARCHAR(40) CHARACTER SET ascii NOT NULL,
  title      VARCHAR(200) NOT NULL,
  content    TEXT NOT NULL,
  sort_no    INT UNSIGNED NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_sort (sort_no)
) ENGINE=InnoDB`);
await conn.beginTransaction();
try {
  await conn.query('DELETE FROM app_help');
  await conn.query('INSERT INTO app_help (anchor, title, content, sort_no) VALUES ?', [rows]);
  await conn.commit();
} catch (e) { await conn.rollback(); throw e; }
console.log('app_help diisi:', rows.length, 'baris dari', heads.length, 'bagian Bantuan.');
try {
  await conn.query("GRANT SELECT ON `media-search`.`app_help` TO 'mcp_ro'@'localhost'");
  console.log('hak baca app_help diberikan ke mcp_ro.');
} catch (e) {
  console.log('PERHATIAN: gagal memberi hak ke mcp_ro (' + e.message + "). Jalankan sebagai admin: GRANT SELECT ON `media-search`.`app_help` TO 'mcp_ro'@'localhost';");
}
await conn.end();
