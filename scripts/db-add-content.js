// Migrasi sekali jalan untuk DB yang sudah ada: tambah kolom content_html & content_checked ke news_items.
//   node scripts/db-add-content.js
import { dbAdmin } from '../src/db.js';

const conn = await dbAdmin();
const [have] = await conn.query("SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'media-search' AND TABLE_NAME = 'news_items' AND COLUMN_NAME IN ('content_html','content_checked')");
const names = new Set(have.map((r) => r.c));
if (!names.has('content_html')) await conn.query('ALTER TABLE `media-search`.news_items ADD COLUMN content_html MEDIUMTEXT NULL AFTER image_checked');
if (!names.has('content_checked')) await conn.query('ALTER TABLE `media-search`.news_items ADD COLUMN content_checked TINYINT(1) NOT NULL DEFAULT 0 AFTER content_html');
console.log('kolom content_html & content_checked siap.');
await conn.end();
