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
import { isGoogleNewsUrl } from './resolver.js';
import { findPublisherUrl, isSearchUrl } from './links.js';

const MIN_BODY_CHARS = 300;          // isi lebih pendek dari ini dianggap belum terbaca (biasanya hanya teks cadangan dari judul/cuplikan)

// Alamat asli artikel di situs penerbit (hasil dekode tautan Google News); null bila belum terselesaikan atau sama dengan tautan awal.
export function realUrl(target, original) {
  if (!target || target === original) return null;
  try { const u = new URL(target); return /^https?:$/.test(u.protocol) && !/(^|\.)news\.google\.com$/.test(u.hostname) ? u.toString().slice(0, 2048) : null; } catch { return null; }
}

export async function enrichContentHtml(companyId, { limit = 300, concurrency = 5, retry = true, signal } = {}) {
  const need = retry
    ? "(content_html IS NULL OR CHAR_LENGTH(content_html) < 300 OR image_url IS NULL OR (article_url IS NULL AND (found_url LIKE 'https://news.google.com/%' OR found_url LIKE 'https://www.google.com/search%' OR found_url LIKE 'https://google.com/search%')))"
    : '((content_html IS NULL AND content_checked = 0) OR (image_url IS NULL AND image_checked = 0))';
  const [rows] = await db().query(
    `SELECT id, title, snippet, found_url AS url, source_domain, source_name, article_url FROM news_items WHERE company_id = ? AND ${need}
       ORDER BY (content_checked = 0 OR image_checked = 0) DESC, (CHAR_LENGTH(COALESCE(content_html, '')) < 300) DESC, (article_url IS NULL) DESC, sort_at DESC LIMIT ?`,
    [companyId, limit],
  );
  let content = 0, images = 0, resolved = 0, unresolved = 0, copied = 0, i = 0;
  async function worker() {
    while (i < rows.length && !signal?.aborted) {
      const r = rows[i++];
      let target = r.article_url || r.url;
      const google = isGoogleNewsUrl(r.url) || isSearchUrl(r.url);
      if (google && !r.article_url) {
        const art = await findPublisherUrl({ masked: r.url, title: r.title, source_domain: r.source_domain, source_name: r.source_name, signal }).catch(() => null);
        if (!art) {
          unresolved++;
          await db().query('UPDATE news_items SET link_error = ? WHERE id = ?', ['decode_gagal', r.id]);
          continue;
        }
        target = art;
        resolved++;
      }
      // Artikel yang sama sudah terambil untuk perusahaan lain: salin isi dan gambarnya, jangan unduh ulang
      const [[sib]] = await db().query('SELECT content_html, image_url, snippet FROM news_items WHERE article_url = ? AND id <> ? AND content_html IS NOT NULL AND CHAR_LENGTH(content_html) >= ? ORDER BY CHAR_LENGTH(content_html) DESC LIMIT 1', [google ? target : (r.article_url || r.url), r.id, MIN_BODY_CHARS]);
      if (sib) {
        await db().query(
          `UPDATE news_items SET content_html = IF(content_html IS NULL OR CHAR_LENGTH(content_html) < CHAR_LENGTH(?), ?, content_html), image_url = COALESCE(image_url, ?), article_url = COALESCE(article_url, ?),
             content_checked = 1, image_checked = 1, link_error = NULL, snippet = IF(snippet IS NULL OR snippet = '', ?, snippet) WHERE id = ?`,
          [sib.content_html, sib.content_html, sib.image_url, google ? target : null, sib.snippet, r.id],
        );
        content++; copied++; if (sib.image_url) images++;
        continue;
      }
      let ex = null;
      try { ex = await extractContentFromUrl(target, { title: r.title, snippet: r.snippet }); } catch { /* ditandai dicek */ }
      const html = ex?.contentHtml || null;
      const isShortForm = /(^|\.)(youtube\.com|youtu\.be|instagram\.com|threads\.net|tiktok\.com|x\.com|twitter\.com)$/i.test(r.source_domain || '') || r.platform === 'video' || r.platform === 'sosmed';
      const minChars = isShortForm ? 80 : MIN_BODY_CHARS;
      const readable = !!html && htmlToText(html).length >= minChars;
      const img = ex?.image ? ex.image.slice(0, 1024) : null;
      const art = google ? target : null;
      // Selalu gantikan isi lama jika isi yang baru berhasil diekstrak lebih panjang
      const contentSql = 'content_html = IF(? IS NOT NULL AND (content_html IS NULL OR CHAR_LENGTH(?) > CHAR_LENGTH(content_html)), ?, content_html)';
      const contentParams = [html, html, html];
      await db().query(
        `UPDATE news_items SET ${contentSql}, image_url = COALESCE(image_url, ?), article_url = COALESCE(article_url, ?), content_checked = 1, image_checked = 1,
           link_error = ?, snippet = IF(snippet IS NULL OR snippet = '', ?, snippet) WHERE id = ?`,
        [...contentParams, img, art, readable ? null : 'isi_tidak_terbaca', ex?.snippet || null, r.id],
      );
      if (readable) content++;
      if (img) images++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  return { checked: rows.length, content, images, resolved, unresolved, copied, stoppedByRateLimit: false };
}
