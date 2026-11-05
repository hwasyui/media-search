// Gambar berita secara lazy: dipanggil browser hanya untuk berita yang sedang tampil dan belum punya gambar. Memakai jalur ekstraksi yang sama dengan
// "Ambil isi & gambar artikel" (extractor.js): tautan Google News didekode ke URL penerbit, lalu og:image / twitter:image / JSON-LD diambil dari halaman
// asli (seperti pratinjau tautan di aplikasi chat). Hasilnya (gambar + isi artikel bila kosong) disimpan ke DB agar tidak diulang.
// Mengembalikan {id: image_url} untuk yang berhasil.
import { db } from './db.js';
import { extractContentFromUrl } from './extractor.js';

export async function enrichByIds(ids, concurrency = 4) {
  if (!ids.length) return {};
  const [rows] = await db().query('SELECT id, url FROM news_items WHERE id IN (?) AND image_url IS NULL AND image_checked = 0', [ids]);
  const out = {};
  let i = 0;
  async function worker() {
    while (i < rows.length) {
      const r = rows[i++];
      let ex = null;
      try { ex = await extractContentFromUrl(r.url); } catch { /* ditandai dicek, tidak diulang */ }
      const img = ex?.image ? ex.image.slice(0, 1024) : null;
      await db().query('UPDATE news_items SET image_url = ?, image_checked = 1, content_html = COALESCE(content_html, ?) WHERE id = ?', [img, ex?.contentHtml || null, r.id]);
      if (img) out[r.id] = img;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  return out;
}
