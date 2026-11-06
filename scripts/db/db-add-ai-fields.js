// Migrasi sekali jalan untuk DB yang sudah ada: tambah ai_summary & company_role ke news_items, lalu buat ulang VIEW news_cleaned
// (SELECT * pada VIEW dibekukan saat dibuat, jadi kolom baru baru muncul setelah VIEW dibuat ulang).
//   node --env-file-if-exists=.env scripts/db/db-add-ai-fields.js
import { readFile } from 'node:fs/promises';
import { dbAdmin } from '../../src/db/db.js';

const conn = await dbAdmin();
await conn.query('USE `media-search`');
const [have] = await conn.query("SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'media-search' AND TABLE_NAME = 'news_items' AND COLUMN_NAME IN ('ai_summary','company_role')");
const names = new Set(have.map((r) => r.c));
if (!names.has('ai_summary')) await conn.query('ALTER TABLE news_items ADD COLUMN ai_summary TEXT NULL AFTER content_checked');
if (!names.has('company_role')) await conn.query('ALTER TABLE news_items ADD COLUMN company_role VARCHAR(16) CHARACTER SET ascii NULL AFTER ai_summary');

const [hasFound] = await conn.query("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'media-search' AND TABLE_NAME = 'news_items' AND COLUMN_NAME = 'found_url'");
if (!hasFound.length) {
  console.log('kolom siap. View belum dibuat ulang karena news_items.url belum diganti nama: jalankan scripts/db/db-rename-url.js (ia membuat ulang semua view).');
  await conn.end();
  process.exit(0);
}
const sql = await readFile(new URL('../../db/schema.sql', import.meta.url), 'utf8');
const view = sql.split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, '').trim()).find((s) => s.startsWith('CREATE OR REPLACE VIEW news_cleaned'));
await conn.query(view);
console.log('kolom ai_summary & company_role siap; view news_cleaned dibuat ulang.');
await conn.end();
