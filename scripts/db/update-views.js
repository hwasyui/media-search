// Pemeliharaan VIEW dan tautan (sekali jalan, aman diulang). Semua berdasar DATABASE (db/schema.sql adalah satu-satunya definisi VIEW):
//  1. article_url yang berisi pencarian Google dikosongkan dan ditandai link_error (alamat penerbit belum diketahui)
//  2. VIEW news_cleaned, news_relevant, v_company_overview dibuat ulang dari db/schema.sql
//  3. Verifikasi: tidak ada berita bertautan pencarian Google / Google News yang belum diselesaikan di news_cleaned
//   node --env-file=.env scripts/db/update-views.js
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, dbAdmin } from '../../src/db/db.js';

const SEARCH = 'https://www.google.com/search?q=%';
const SEARCH2 = 'https://google.com/search?q=%';      // bentuk tanpa www (hasil kanonisasi alamat)
const [r1] = await db().query('UPDATE news_items SET article_url = NULL, link_error = ? WHERE article_url LIKE ? OR article_url LIKE ?', ['decode_gagal', SEARCH, SEARCH2]);
console.log('article_url pencarian Google dikosongkan:', r1.affectedRows);
const [r2] = await db().query('UPDATE news_items SET link_error = ? WHERE (found_url LIKE ? OR found_url LIKE ?) AND article_url IS NULL', ['decode_gagal', SEARCH, SEARCH2]);
console.log('berita bertautan pencarian Google ditandai:', r2.affectedRows);

// Buat ulang semua VIEW dari schema.sql (komentar -- dibuang dulu agar pemisahan per titik-koma aman)
const sql = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../db/schema.sql'), 'utf8').replace(/--[^\n]*/g, '');
const views = sql.split(';').map((x) => x.trim()).filter((x) => /^CREATE OR REPLACE VIEW/i.test(x));
const conn = await dbAdmin();
await conn.query('USE `media-search`');
for (const v of views) { await conn.query(v); console.log('view dibuat ulang:', /VIEW\s+(\w+)/i.exec(v)[1]); }
await conn.end();

const [[bad1]] = await db().query('SELECT COUNT(*) n FROM news_cleaned WHERE COALESCE(article_url, found_url) LIKE ?', [SEARCH]);
const [[bad2]] = await db().query("SELECT COUNT(*) n FROM news_cleaned WHERE COALESCE(article_url, found_url) LIKE 'https://news.google.com/%'");
const [[total]] = await db().query('SELECT COUNT(*) n FROM news_cleaned');
const [[rel]] = await db().query('SELECT COUNT(*) n FROM news_relevant');
const [[raw]] = await db().query('SELECT COUNT(*) n FROM news_items');
console.log('di news_cleaned -> pencarian Google:', bad1.n, '| Google News belum diselesaikan:', bad2.n);
console.log('lapis data -> mentah:', raw.n, '| cleaned:', total.n, '| relevan:', rel.n);
process.exit(0);
