// Backfill isi artikel + gambar + alamat asli: dari SATU kali unduh per artikel diambil badan artikel (HTML bersih per paragraf) dan gambar pratinjau
// untuk berita yang belum punya. Tanpa AI. Item yang sudah dicoba ditandai content_checked/image_checked; { retry: true } (default Task Runner)
// ikut mencoba lagi yang gagal, yang belum pernah dicoba lebih dulu.
//
// Tautan Google News diselesaikan dulu ke alamat penerbit lewat antrean berurutan (gnews.js: satu per satu, backoff saat 429), disimpan di article_url,
// lalu alamat penerbit itulah yang diberikan ke ekstraktor (extractor.js, tidak diubah). Bila tautan belum bisa diselesaikan, ekstraktor TIDAK dipanggil
// untuk item itu (supaya yang tersimpan bukan teks cadangan dari judul), alasannya dicatat di link_error, dan item dicoba lagi pada jalan berikutnya.
import { db } from './db.js';
import { extractContentFromUrl, htmlToText } from './extractor.js';
import { isGoogleArticle, resolveGoogleUrl } from './gnews.js';
import { isGoogleNewsUrl, resolveArticleUrl } from './resolver.js';

const MIN_BODY_CHARS = 300;          // isi lebih pendek dari ini dianggap belum terbaca (biasanya hanya teks cadangan dari judul/cuplikan)

// Alamat asli artikel di situs penerbit (hasil dekode tautan Google News); null bila belum terselesaikan atau sama dengan tautan awal.
export function realUrl(target, original) {
  if (!target || target === original) return null;
  try { const u = new URL(target); return /^https?:$/.test(u.protocol) && !/(^|\.)news\.google\.com$/.test(u.hostname) ? u.toString().slice(0, 2048) : null; } catch { return null; }
}

export async function enrichContentHtml(companyId, { limit = 300, concurrency = 5, retry = true, signal } = {}) {
  const need = retry
    ? "(content_html IS NULL OR image_url IS NULL OR (url LIKE 'https://news.google.com/%' AND article_url IS NULL))"
    : '((content_html IS NULL AND content_checked = 0) OR (image_url IS NULL AND image_checked = 0))';
  const [rows] = await db().query(
    `SELECT id, title, snippet, url, source_domain, source_name, article_url FROM news_items WHERE company_id = ? AND ${need}
       ORDER BY (content_checked = 0 OR image_checked = 0) DESC, (article_url IS NULL) DESC, sort_at DESC LIMIT ?`,
    [companyId, limit],
  );
  let content = 0, images = 0, resolved = 0, unresolved = 0, i = 0;
  async function worker() {
    while (i < rows.length && !signal?.aborted) {
      const r = rows[i++];
      let target = r.article_url || r.url;
      const google = isGoogleNewsUrl(r.url);
      if (google && !r.article_url) {
        const art = await resolveArticleUrl(r).catch(() => null);
        if (!art || isGoogleNewsUrl(art)) {
          unresolved++;
          await db().query('UPDATE news_items SET link_error = ? WHERE id = ?', ['decode_gagal', r.id]);
          continue;
        }
        target = art;
        resolved++;
      }
      let ex = null;
      try { ex = await extractContentFromUrl(target, { title: r.title, snippet: r.snippet }); } catch { /* ditandai dicek */ }
      const html = ex?.contentHtml || null;
      const readable = !!html && htmlToText(html).length >= MIN_BODY_CHARS;
      const img = ex?.image ? ex.image.slice(0, 1024) : null;
      const art = google ? target : null;
      // Dari alamat penerbit: isi yang lebih panjang menggantikan isi lama (isi lama bisa teks cadangan dari judul). Selain itu hanya mengisi yang kosong.
      const contentSql = art
        ? 'content_html = IF(? IS NOT NULL AND (content_html IS NULL OR CHAR_LENGTH(?) > CHAR_LENGTH(content_html)), ?, content_html)'
        : 'content_html = COALESCE(content_html, ?)';
      const contentParams = art ? [html, html, html] : [html];
      await db().query(
        `UPDATE news_items SET ${contentSql}, image_url = COALESCE(image_url, ?), article_url = COALESCE(article_url, ?), url = COALESCE(?, url), content_checked = 1, image_checked = 1,
           link_error = ?, snippet = IF(snippet IS NULL OR snippet = '', ?, snippet) WHERE id = ?`,
        [...contentParams, img, art, art, readable ? null : 'isi_tidak_terbaca', ex?.snippet || null, r.id],
      );
      if (readable) content++;
      if (img) images++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  return { checked: rows.length, content, images, resolved, unresolved, stoppedByRateLimit: false };
}
