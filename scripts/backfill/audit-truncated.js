import { db } from '../../src/db/db.js';

async function main() {
  console.log('=== AUDIT KONTEN TERPOTONG / PENDEK ===\n');

  // 1. Cek yang berakhiran elipsis (...) di content_html
  const [withEllipsis] = await db().query(`
    SELECT count(*) as cnt
    FROM news_items
    WHERE stage >= 1 AND (content_html LIKE '%...%' OR content_html LIKE '%…%')
  `);
  console.log('Item stage >= 1 dengan elipsis (... / …):', withEllipsis[0].cnt);

  // 2. Cek yang panjangnya < 500 karakter di stage >= 1
  const [shortStage1] = await db().query(`
    SELECT count(*) as cnt
    FROM news_items
    WHERE stage >= 1 AND (CHAR_LENGTH(REGEXP_REPLACE(COALESCE(content_html, ''), '<[^>]*>', '')) < 500)
  `);
  console.log('Item stage >= 1 dengan teks polos < 500 karakter:', shortStage1[0].cnt);

  // 3. Breakdown per domain untuk item teks < 500 karakter di stage >= 1
  const [domainBreakdown] = await db().query(`
    SELECT source_domain, platform, count(*) as cnt,
           avg(CHAR_LENGTH(REGEXP_REPLACE(COALESCE(content_html, ''), '<[^>]*>', ''))) as avg_len
    FROM news_items
    WHERE stage >= 1 AND (CHAR_LENGTH(REGEXP_REPLACE(COALESCE(content_html, ''), '<[^>]*>', '')) < 500)
    GROUP BY source_domain, platform
    ORDER BY cnt DESC
    LIMIT 15
  `);
  console.log('\nTop domain dengan konten < 500 karakter:');
  console.table(domainBreakdown);

  // 4. Sample 10 item yang terindikasi terpotong
  const [samples] = await db().query(`
    SELECT id, title, found_url, article_url, source_domain, platform,
           CHAR_LENGTH(REGEXP_REPLACE(COALESCE(content_html, ''), '<[^>]*>', '')) as text_len,
           content_html
    FROM news_items
    WHERE stage >= 1 
      AND platform NOT IN ('video', 'sosmed')
      AND (CHAR_LENGTH(REGEXP_REPLACE(COALESCE(content_html, ''), '<[^>]*>', '')) < 500)
    ORDER BY id DESC
    LIMIT 10
  `);
  console.log('\nSample 10 artikel web stage >= 1 yang teksnya < 500 karakter:');
  for (const s of samples) {
    console.log(`\n[ID #${s.id}] domain: ${s.source_domain} (len: ${s.text_len})`);
    console.log(`Judul: ${s.title}`);
    console.log(`URL: ${s.article_url || s.found_url}`);
    console.log(`Isi: ${(s.content_html || '').replace(/\n/g, ' ')}`);
  }

  process.exit(0);
}

main().catch(console.error);

