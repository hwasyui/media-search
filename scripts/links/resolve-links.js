// Backfill alamat asli untuk semua berita yang masih berupa tautan Google News.
// Menyelesaikan URL menggunakan Bing News RSS & Google Search fallback (bebas 429),
// dan menyimpan hasilnya langsung ke news_items.article_url (alamat penerbit). found_url/url_hash tidak diubah (itu alamat saat ditemukan, dasar pencegah duplikat).
//
//   node --env-file-if-exists=.env scripts/links/resolve-links.js [--concurrency 6] [--limit 2000]

import { db } from '../../src/db/db.js';
import { resolveArticleUrl, isGoogleNewsUrl } from '../../src/links/resolver.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const limit = Number(arg('limit', 100000));
const concurrency = Number(arg('concurrency', 6));
const company = arg('company', null);

const [rows] = await db().query(
  `SELECT id, title, found_url AS url, snippet, source_domain, source_name, article_url FROM news_items
   WHERE (found_url LIKE '%news.google.com%' OR article_url LIKE '%news.google.com%' OR article_url IS NULL)
   ${company ? 'AND company_id = ?' : ''}
   ORDER BY id DESC LIMIT ?`,
  company ? [company, limit] : [limit],
);

const googleRows = rows.filter((r) => isGoogleNewsUrl(r.url) || isGoogleNewsUrl(r.article_url) || !r.article_url);
console.log(`Ditemukan ${googleRows.length} berita yang perlu diselesaikan alamat aslinya.`);

if (!googleRows.length) {
  console.log('Semua berita sudah memiliki alamat asli penerbit.');
  await db().end?.();
  process.exit(0);
}

let ok = 0, fail = 0, idx = 0;
const t0 = Date.now();

async function worker() {
  while (idx < googleRows.length) {
    const r = googleRows[idx++];
    try {
      const art = await resolveArticleUrl(r);
      if (art && !isGoogleNewsUrl(art)) {
        await db().query('UPDATE news_items SET article_url = ?, link_error = NULL WHERE id = ?', [art, r.id]);
        ok++;
      } else {
        await db().query('UPDATE news_items SET link_error = ? WHERE id = ?', ['decode_gagal', r.id]);
        fail++;
      }
    } catch (e) {
      fail++;
    }

    const done = ok + fail;
    if (done % 25 === 0 || done === googleRows.length) {
      const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
      const rate = (done / (elapsedSec || 1)).toFixed(1);
      console.log(`[${elapsedSec}s] Selesai ${done}/${googleRows.length} (${rate}/s) — Berhasil: ${ok}, Gagal: ${fail}`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, googleRows.length) }, worker));

console.log(`\nSelesai backfill! Total ${ok} berita berhasil diperbarui ke URL asli penerbit.`);
await db().end?.();
process.exit(0);
