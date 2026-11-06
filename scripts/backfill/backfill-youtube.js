import { db } from '../../src/db/db.js';
import { extractContentFromUrl } from '../../src/content/extractor.js';

async function main() {
  console.log('Starting YouTube backfill...');

  // 1. Get all YouTube items
  const [rows] = await db().query(`
    SELECT id, found_url, title, snippet, content_html, image_url
    FROM news_items
    WHERE (found_url LIKE '%youtube%' OR found_url LIKE '%youtu.be%')
    ORDER BY id ASC
  `);

  console.log(`Found ${rows.length} YouTube items in news_items.`);

  // Group by found_url to avoid redundant network requests
  const urlMap = new Map();
  for (const r of rows) {
    if (!urlMap.has(r.found_url)) {
      urlMap.set(r.found_url, []);
    }
    urlMap.get(r.found_url).push(r);
  }

  const uniqueUrls = Array.from(urlMap.keys());
  console.log(`Total unique YouTube URLs: ${uniqueUrls.length}`);

  let updatedItems = 0;
  let processedUrls = 0;
  const concurrency = 8;
  let urlIdx = 0;

  async function worker() {
    while (urlIdx < uniqueUrls.length) {
      const url = uniqueUrls[urlIdx++];
      const items = urlMap.get(url);
      const sample = items[0];

      try {
        const extracted = await extractContentFromUrl(url, {
          title: sample.title,
          snippet: sample.snippet,
        });

        if (extracted && extracted.contentHtml) {
          const newHtml = extracted.contentHtml;
          const newSnippet = extracted.snippet || null;
          const newImage = extracted.image || null;

          for (const item of items) {
            const currentLen = item.content_html ? item.content_html.length : 0;
            const hasEllipsis = item.content_html && item.content_html.includes('...');
            // Update if new content is longer or current content has ellipsis
            if (newHtml.length > currentLen || hasEllipsis) {
              await db().query(`
                UPDATE news_items
                SET content_html = ?,
                    snippet = COALESCE(?, snippet),
                    image_url = COALESCE(image_url, ?),
                    content_checked = 1,
                    link_error = NULL
                WHERE id = ?
              `, [newHtml, newSnippet, newImage, item.id]);
              updatedItems++;
            }
          }
        }
      } catch (err) {
        console.error(`Error processing ${url}:`, err.message);
      }

      processedUrls++;
      if (processedUrls % 50 === 0 || processedUrls === uniqueUrls.length) {
        console.log(`Progress: ${processedUrls}/${uniqueUrls.length} URLs processed, ${updatedItems} items updated.`);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  console.log(`YouTube backfill completed! Total updated rows: ${updatedItems}`);

  // Check specific target:
  const [targets] = await db().query(`
    SELECT id, title, found_url, length(content_html) as len, content_html, stage
    FROM news_items
    WHERE title LIKE '%Danantara Bisa Jadi Pintu Ekspor Tembaga%'
  `);
  console.log('\nTarget items verification:');
  for (const t of targets) {
    console.log(`[ID ${t.id}] stage:${t.stage} len:${t.len}`);
    console.log(`Content:\n${t.content_html}\n`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

