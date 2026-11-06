import { db } from '../../src/db/db.js';
import { resolveArticleUrl } from '../../src/links/resolver.js';
import { extractContentFromUrl, htmlToText } from '../../src/content/extractor.js';
import { cleanDomain } from '../../src/links/links.js';

async function main() {
  console.log('=== MEMULAI PROSES UNMASK & ENRICH KONTEN ===\n');

  // 1. Ambil semua item yang belum punya article_url atau belum punya isi
  const [rows] = await db().query(`
    SELECT id, title, snippet, found_url, source_domain, source_name, article_url, content_html, image_url, stage, platform
    FROM news_items
    WHERE article_url IS NULL
       OR content_html IS NULL
       OR CHAR_LENGTH(content_html) < 200
    ORDER BY (article_url IS NULL) DESC, id DESC
  `);

  console.log(`Ditemukan ${rows.length} berita untuk diproses (unmask URL asli dan/atau ambil isi lengkap).\n`);

  let unmaskedCount = 0;
  let contentFilledCount = 0;
  let skippedCount = 0;
  let processed = 0;
  const total = rows.length;

  const concurrency = 4; // Concurrency sedang agar stabil dan aman dari rate limit
  let idx = 0;

  async function worker() {
    while (idx < rows.length) {
      const r = rows[idx++];
      let realUrl = r.article_url;
      let newDomain = null;

      // 1. Unmask jika belum punya article_url
      if (!realUrl) {
        try {
          const dom = cleanDomain(r.source_domain, r.source_name, r.found_url);
          const resolved = await resolveArticleUrl({
            url: r.found_url,
            title: r.title,
            snippet: r.snippet,
            source_domain: dom,
            source_name: r.source_name,
          });

          if (resolved && !resolved.includes('google.com/search') && !resolved.includes('news.google.com')) {
            realUrl = resolved;
            unmaskedCount++;
            try {
              newDomain = new URL(realUrl).hostname.replace(/^www\./, '').toLowerCase();
            } catch {}
          }
        } catch (e) {
          // ignore
        }
      }

      // 2. Ekstrak isi artikel jika ada alamat valid dan konten masih kosong / pendek
      let newContentHtml = null;
      let newSnippet = null;
      let newImage = null;

      const targetFetchUrl = realUrl || (!r.found_url.includes('google.com') ? r.found_url : null);

      if (targetFetchUrl && (!r.content_html || r.content_html.length < 200)) {
        try {
          const ex = await extractContentFromUrl(targetFetchUrl, {
            title: r.title,
            snippet: r.snippet,
          });

          if (ex?.contentHtml && ex.contentHtml.length > (r.content_html?.length || 0)) {
            newContentHtml = ex.contentHtml;
            newSnippet = ex.snippet || null;
            newImage = ex.image || null;
            contentFilledCount++;
          }
        } catch (e) {
          // ignore
        }
      }

      // 3. Simpan perubahan ke database
      if (realUrl !== r.article_url || newContentHtml || newDomain) {
        const updates = [];
        const params = [];

        if (realUrl && realUrl !== r.article_url) {
          updates.push('article_url = ?');
          params.push(realUrl);
          updates.push('link_error = NULL');
        }
        if (newDomain && (r.source_domain === 'google.com' || !r.source_domain)) {
          updates.push('source_domain = ?');
          params.push(newDomain);
        }
        if (newContentHtml) {
          updates.push('content_html = ?');
          params.push(newContentHtml);
          updates.push('content_checked = 1');
        }
        if (newSnippet && (!r.snippet || r.snippet.length < 50)) {
          updates.push('snippet = ?');
          params.push(newSnippet);
        }
        if (newImage && !r.image_url) {
          updates.push('image_url = ?');
          params.push(newImage);
          updates.push('image_checked = 1');
        }

        if (updates.length) {
          params.push(r.id);
          await db().query(`UPDATE news_items SET ${updates.join(', ')} WHERE id = ?`, params);
        }
      } else {
        skippedCount++;
      }

      processed++;
      if (processed % 20 === 0 || processed === total) {
        console.log(`[Progres ${processed}/${total}] Unmasked: ${unmaskedCount} | Isi terisi: ${contentFilledCount} | Belum/Skip: ${skippedCount}`);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  console.log('\n=== SELESAI PROSES UNMASK & ENRICH ===');
  console.log(`Total berhasil unmask URL asli : ${unmaskedCount}`);
  console.log(`Total berhasil isi konten/gambar: ${contentFilledCount}`);

  // Tampilkan statistik terbaru
  const [[stat]] = await db().query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN article_url IS NULL THEN 1 ELSE 0 END) AS no_article_url,
      SUM(CASE WHEN stage = 0 THEN 1 ELSE 0 END) AS stage_0,
      SUM(CASE WHEN stage = 1 THEN 1 ELSE 0 END) AS stage_1,
      SUM(CASE WHEN stage = 2 THEN 1 ELSE 0 END) AS stage_2,
      SUM(CASE WHEN content_html IS NULL OR CHAR_LENGTH(content_html) = 0 THEN 1 ELSE 0 END) AS no_content
    FROM news_items
  `);
  console.log('\nStatistik Terkini Database:', stat);

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

