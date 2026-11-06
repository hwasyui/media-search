// Migrasi sekali jalan: ganti nama kolom news_items.url -> found_url (alamat saat ditemukan, dasar pencegah duplikat) lalu buat ulang VIEW
// (news_cleaned, news_relevant, v_company_overview) dari db/schema.sql. article_url tetap = alamat asli penerbit.
// Baris lama: found_url berisi alamat penerbit (alamat awalnya sudah tidak tersimpan); hash lama tidak berubah.
//
// URUTAN WAJIB: hentikan job yang sedang berjalan -> jalankan skrip ini -> RESTART server (kode baru memakai found_url).
//   node scripts/db/db-rename-url.js
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbAdmin } from '../../src/db/db.js';

const conn = await dbAdmin();
const [cols] = await conn.query("SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'media-search' AND TABLE_NAME = 'news_items' AND COLUMN_NAME IN ('url','found_url')");
const have = new Set(cols.map((r) => r.c));
if (have.has('url') && !have.has('found_url')) {
  await conn.query('ALTER TABLE `media-search`.news_items CHANGE COLUMN url found_url VARCHAR(2048) NOT NULL');
  console.log('kolom url -> found_url: selesai.');
} else console.log('kolom found_url sudah ada: lewati penggantian nama.');

// Isi article_url yang masih kosong dari found_url bila itu sudah alamat penerbit (bukan tautan Google)
const [r] = await conn.query("UPDATE `media-search`.news_items SET article_url = found_url WHERE article_url IS NULL AND found_url NOT LIKE 'https://news.google.com/%' AND found_url NOT LIKE 'https://www.google.com/search%'");
console.log('article_url dilengkapi:', r.affectedRows, 'baris.');

// Buat ulang VIEW dari schema.sql (komentar -- dibuang lebih dulu agar pemisahan per titik-koma aman)
const sql = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../db/schema.sql'), 'utf8').replace(/--[^\n]*/g, '');
const views = sql.split(';').map((x) => x.trim()).filter((x) => /^CREATE OR REPLACE VIEW/i.test(x));
await conn.query('USE `media-search`');
for (const v of views) { await conn.query(v); console.log('view dibuat ulang:', /VIEW\s+(\w+)/i.exec(v)[1]); }
await conn.end();
console.log('SELESAI. Restart server sekarang.');
