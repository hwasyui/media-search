import { db } from '../../src/db/db.js';
import { resolveArticleUrl } from '../../src/links/resolver.js';
import { extractContentFromUrl, htmlToText } from '../../src/content/extractor.js';

async function main() {
  console.log('=== MEMULAI BACKFILL & UNMASKING KOMPREHENSIF ===');

  // -------------------------------------------------------------
  // FASE 1: UNMASKING SEMUA TAUTAN STAGE 0 (Google News / Search)
  // -------------------------------------------------------------
  const [unmaskRows] = await db().query(`
    SELECT id, title, found_url, source_domain, source_name 
    FROM news_items 
    WHERE (article_url IS NULL OR article_url LIKE 'https://news.google.com/%' OR article_url LIKE 'https://www.google.com/search%' OR article_url LIKE 'https://google.com/search%')
      AND (found_url LIKE 'https://news.google.com/%' OR found_url LIKE 'https://www.google.com/search%' OR found_url LIKE 'https://google.com/search%')
    ORDER BY id DESC
  `);

  console.log(`\n[FASE 1] Ditemukan ${unmaskRows.length} tautan yang memerlukan unmasking...`);
  let unmaskSuccess = 0;
  let unmaskFailed = 0;
  let unmaskIdx = 0;
  const UNMASK_CONCURRENCY = 5;

  async function unmaskWorker() {
    while (unmaskIdx < unmaskRows.length) {
      const r = unmaskRows[unmaskIdx++];
      try {
        const real = await resolveArticleUrl({
          id: r.id,
          url: r.found_url,
          title: r.title,
          source_domain: r.source_domain,
          source_name: r.source_name
        });

        if (real && !real.startsWith('https://news.google.com') && !real.includes('google.com/search')) {
          let domain = null;
          try { domain = new URL(real).hostname.replace(/^www\./, ''); } catch {}
          await db().query(
            'UPDATE news_items SET article_url = ?, source_domain = COALESCE(?, source_domain), link_error = NULL, content_checked = 0 WHERE id = ?',
            [real, domain, r.id]
          );
          unmaskSuccess++;
          console.log(`[UNMASK OK #${r.id}] -> ${real.slice(0, 75)}...`);
        } else {
          unmaskFailed++;
          await db().query('UPDATE news_items SET link_error = "unresolved" WHERE id = ?', [r.id]);
        }
      } catch (e) {
        unmaskFailed++;
      }

      if (unmaskIdx % 25 === 0) {
        console.log(`[FASE 1 Progress] ${unmaskIdx}/${unmaskRows.length} diproses (${unmaskSuccess} berhasil)`);
      }
    }
  }

  await Promise.all(Array.from({ length: UNMASK_CONCURRENCY }, unmaskWorker));
  console.log(`\n[FASE 1 SELESAI] Berhasil unmask: ${unmaskSuccess}, Gagal/Belum ketemu: ${unmaskFailed}`);

  // -------------------------------------------------------------
  // FASE 2: EKSTRAKSI & PENGAYAAN KONTEN ARTIKEL (STAGE >= 1)
  // -------------------------------------------------------------
  const [contentRows] = await db().query(`
    SELECT id, title, COALESCE(article_url, found_url) AS target_url, snippet, CHAR_LENGTH(COALESCE(content_html, '')) AS cur_len
    FROM news_items 
    WHERE stage >= 1 
      AND (content_html IS NULL OR CHAR_LENGTH(content_html) < 500)
      AND (article_url NOT LIKE 'https://news.google.com/%' AND article_url NOT LIKE 'https://www.google.com/search%' OR article_url IS NULL)
      AND found_url NOT LIKE 'https://www.google.com/search%'
      AND found_url NOT LIKE 'https://news.google.com/%'
    ORDER BY (content_html IS NULL) DESC, id DESC
  `);

  console.log(`\n[FASE 2] Ditemukan ${contentRows.length} artikel Stage >= 1 dengan teks pendek/kosong...`);
  let contentSuccess = 0;
  let contentSkipped = 0;
  let contentIdx = 0;
  const CONTENT_CONCURRENCY = 4;

  async function contentWorker() {
    while (contentIdx < contentRows.length) {
      const item = contentRows[contentIdx++];
      try {
        const ex = await extractContentFromUrl(item.target_url, { title: item.title, snippet: item.snippet });
        const html = ex?.contentHtml || null;
        const newLen = html ? html.length : 0;

        if (newLen > item.cur_len && newLen >= 300) {
          await db().query(
            'UPDATE news_items SET content_html = ?, image_url = COALESCE(image_url, ?), content_checked = 1 WHERE id = ?',
            [html, ex?.image || null, item.id]
          );
          contentSuccess++;
          console.log(`[CONTENT OK #${item.id}] Dari ${item.cur_len} -> ${newLen} chars (${item.target_url.slice(0, 60)}...)`);
        } else {
          contentSkipped++;
          await db().query('UPDATE news_items SET content_checked = 1 WHERE id = ?', [item.id]);
        }
      } catch (e) {
        contentSkipped++;
      }

      if (contentIdx % 25 === 0) {
        console.log(`[FASE 2 Progress] ${contentIdx}/${contentRows.length} diperiksa (${contentSuccess} berhasil diperkaya)`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONTENT_CONCURRENCY }, contentWorker));
  console.log(`\n[FASE 2 SELESAI] Artikel berhasil diperkaya: ${contentSuccess}, Tidak berubah/pendek asli: ${contentSkipped}`);

  // -------------------------------------------------------------
  // FASE 3: STATISTIK AKHIR LAPIS DATA
  // -------------------------------------------------------------
  const [stages] = await db().query('SELECT stage, count(*) as cnt FROM news_items GROUP BY stage ORDER BY stage ASC');
  console.log('\n=== LAPIS DATA AKHIR (news_items) ===');
  for (const s of stages) {
    console.log(` - Stage ${s.stage} (${s.stage === 0 ? 'Mentah / Unresolved' : s.stage === 1 ? 'Cleaned (Valid URL)' : 'Relevan (Full Content & Verified)'}): ${s.cnt} berita`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('[FATAL ERROR]', err);
  process.exit(1);
});
