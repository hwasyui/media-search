import { db } from '../../src/db/db.js';

async function main() {
  const [stageCounts] = await db().query('SELECT stage, count(*) as cnt FROM news_items GROUP BY stage');
  console.log('Stage counts:', stageCounts);

  const [unresolvedGoogle] = await db().query(`
    SELECT count(*) as cnt FROM news_items 
    WHERE (article_url IS NULL OR article_url LIKE 'https://news.google.com/%' OR article_url LIKE 'https://www.google.com/search%') 
      AND (found_url LIKE 'https://news.google.com/%' OR found_url LIKE 'https://www.google.com/search%' OR found_url LIKE 'https://google.com/search%')
  `);
  console.log('Unresolved Google URLs:', unresolvedGoogle[0].cnt);

  const [shortContentStage1] = await db().query(`
    SELECT count(*) as cnt FROM news_items 
    WHERE stage >= 1 AND (content_html IS NULL OR CHAR_LENGTH(content_html) < 500)
  `);
  console.log('Stage >= 1 with short/null content:', shortContentStage1[0].cnt);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

