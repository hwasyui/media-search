import fs from 'node:fs';
import { db } from '../../src/db/db.js';

async function main() {
  const auditData = JSON.parse(fs.readFileSync('data/audit/cleaned-truncated.json', 'utf8'));
  const items = auditData.terpotong || [];
  console.log(`Mengecek ${items.length} item dari cleaned-truncated.json terhadap database sekarang...\n`);

  const ids = items.map(x => x.id);
  const [rows] = await db().query(`
    SELECT id, title, source_domain, article_url, char_length(regexp_replace(coalesce(content_html, ''), '<[^>]*>', '')) as cur_len,
           content_html LIKE '%...%' as has_ellipsis
    FROM news_items
    WHERE id IN (?)
  `, [ids]);

  const rowMap = new Map(rows.map(r => [r.id, r]));

  let muchLonger = 0;
  let stillSame = 0;

  console.log('Perbandingan panjang tersimpan lama vs sekarang:');
  for (const item of items) {
    const cur = rowMap.get(item.id);
    if (!cur) {
      console.log(`[#${item.id}] Tidak ditemukan di DB`);
      continue;
    }
    const diff = cur.cur_len - item.len;
    if (diff > 200) {
      muchLonger++;
      console.log(`[#${item.id}] SUDAH DIPERPANJANG: ${item.len} -> ${cur.cur_len} chars (+${diff}) | ${item.domain} | ${item.title.slice(0, 45)}...`);
    } else {
      stillSame++;
      console.log(`[#${item.id}] MASIH SAMA / PENDEK: ${item.len} -> ${cur.cur_len} chars | ${item.domain} | has_ellipsis: ${cur.has_ellipsis} | ${item.title.slice(0, 45)}...`);
    }
  }

  console.log(`\nRingkasan: ${muchLonger} sudah diperpanjang, ${stillSame} masih sama.`);
  process.exit(0);
}

main().catch(console.error);

