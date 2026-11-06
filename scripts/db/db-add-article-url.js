// Migrasi sekali jalan: tambah kolom article_url (alamat artikel asli di situs penerbit) dan link_error (alasan tautan/isi gagal) ke news_items,
// lalu buat ulang VIEW news_cleaned (SELECT * pada VIEW dibekukan saat dibuat, jadi kolom baru baru terlihat setelah VIEW dibuat ulang).
//   node --env-file-if-exists=.env scripts/db/db-add-article-url.js
import { readFile } from 'node:fs/promises';
import { dbAdmin } from '../../src/db/db.js';

const conn = await dbAdmin();
await conn.query('USE `media-search`');
const [have] = await conn.query("SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'media-search' AND TABLE_NAME = 'news_items' AND COLUMN_NAME IN ('article_url','link_error')");
const names = new Set(have.map((r) => r.c));
if (!names.has('article_url')) await conn.query('ALTER TABLE news_items ADD COLUMN article_url VARCHAR(2048) NULL AFTER content_checked');
if (!names.has('link_error')) await conn.query('ALTER TABLE news_items ADD COLUMN link_error VARCHAR(40) CHARACTER SET ascii NULL AFTER article_url');

const [hasFound] = await conn.query("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'media-search' AND TABLE_NAME = 'news_items' AND COLUMN_NAME = 'found_url'");
if (!hasFound.length) {
  console.log('kolom siap. View belum dibuat ulang karena news_items.url belum diganti nama: jalankan scripts/db/db-rename-url.js (ia membuat ulang semua view).');
  await conn.end();
  process.exit(0);
}
const sql = await readFile(new URL('../../db/schema.sql', import.meta.url), 'utf8');
const view = sql.split(/;\s*\n/).map((x) => x.replace(/^\s*--.*$/gm, '').trim()).find((x) => x.startsWith('CREATE OR REPLACE VIEW news_cleaned'));
if (!view) throw new Error('definisi VIEW news_cleaned tidak ditemukan di db/schema.sql');
await conn.query(view);
console.log('kolom article_url & link_error siap; view news_cleaned dibuat ulang.');
await conn.end();
