// Pelengkap gambar berita: ambil og:image / twitter:image dari halaman artikel asli (satu request biasa per artikel,
// timeout pendek, tanpa menembus proteksi apa pun: kalau situs menolak, item ditandai "sudah dicek" dan dilewati).
// Tautan Google News (news.google.com/rss/articles/...) hanya pengalihan, bukan halaman artikel, jadi dilewati;
// untuk itu UI memakai logo penerbit dari source_domain.
import { db } from './db.js';

const UA = 'Mozilla/5.0 (compatible; media-search/1.0)';
const META = /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*>/gi;

function pickImage(html, baseUrl) {
  for (const tag of html.match(META) || []) {
    const c = tag.match(/content=["']([^"']+)["']/i)?.[1];
    if (!c) continue;
    try {
      const u = new URL(c.replace(/&amp;/g, '&'), baseUrl);
      if (/^https?:$/.test(u.protocol)) return u.toString();
    } catch { /* coba tag berikutnya */ }
  }
  return null;
}

async function fetchImage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(7000), redirect: 'follow' });
  if (!res.ok || !/html/i.test(res.headers.get('content-type') || '')) return null;
  // cukup bagian <head>: baca maksimal ~150 KB
  const reader = res.body.getReader();
  let html = '', bytes = 0;
  const dec = new TextDecoder();
  while (bytes < 150_000) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length; html += dec.decode(value, { stream: true });
    if (/<\/head>/i.test(html)) break;
  }
  reader.cancel().catch(() => {});
  return pickImage(html, res.url || url);
}

// Lengkapi gambar untuk item perusahaan yang belum punya (terbaru dulu). Mengembalikan jumlah yang berhasil.
export async function enrichImages(companyId, limit = 40, concurrency = 6) {
  const [rows] = await db().query(
    `SELECT id, url FROM news_items WHERE company_id = ? AND image_url IS NULL AND image_checked = 0
       AND url NOT LIKE 'https://news.google.com/%' ORDER BY sort_at DESC LIMIT ?`,
    [companyId, limit],
  );
  let found = 0, i = 0;
  async function worker() {
    while (i < rows.length) {
      const r = rows[i++];
      let img = null;
      try { img = await fetchImage(r.url); } catch { /* ditandai dicek, tidak diulang */ }
      await db().query('UPDATE news_items SET image_url = ?, image_checked = 1 WHERE id = ?', [img ? img.slice(0, 1024) : null, r.id]);
      if (img) found++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  return { checked: rows.length, found };
}

// Lazy: ambil gambar hanya untuk berita yang sedang ditampilkan (id dari browser), lalu simpan ke DB agar tidak diulang.
// Tautan Google News dilewati (pengalihan, bukan halaman artikel). Mengembalikan {id: image_url} untuk yang berhasil.
export async function enrichByIds(ids, concurrency = 4) {
  if (!ids.length) return {};
  const [rows] = await db().query(
    "SELECT id, url FROM news_items WHERE id IN (?) AND image_checked = 0 AND image_url IS NULL AND url NOT LIKE 'https://news.google.com/%'",
    [ids],
  );
  const out = {};
  let i = 0;
  async function worker() {
    while (i < rows.length) {
      const r = rows[i++];
      let img = null;
      try { img = await fetchImage(r.url); } catch { /* ditandai dicek, tidak diulang */ }
      await db().query('UPDATE news_items SET image_url = ?, image_checked = 1 WHERE id = ?', [img ? img.slice(0, 1024) : null, r.id]);
      if (img) out[r.id] = img;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  return out;
}
