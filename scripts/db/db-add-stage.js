// Migrasi sekali jalan: tambah kolom stage (lapis data: 0 mentah, 1 cleaned, 2 relevan; dihitung otomatis dan diindeks) ke news_items,
// lalu buat ulang semua VIEW dari db/schema.sql (news_cleaned = stage >= 1, news_relevant = stage = 2) dan beri hak baca news_relevant ke mcp_ro.
//   node --env-file=.env scripts/db/db-add-stage.js        (jalankan SETELAH scripts/db/db-rename-url.js, lalu restart server)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbAdmin } from '../../src/db/db.js';

const conn = await dbAdmin();
await conn.query('USE `media-search`');
const sql = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../db/schema.sql'), 'utf8').replace(/--[^\n]*/g, '');

const defOf = () => { const m = /(stage\s+TINYINT UNSIGNED GENERATED ALWAYS AS \(CASE[\s\S]*?END\) STORED)/.exec(sql); if (!m) throw new Error('definisi kolom stage tidak ditemukan di db/schema.sql'); return m[1]; };
const [have] = await conn.query("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'media-search' AND TABLE_NAME = 'news_items' AND COLUMN_NAME = 'stage'");
if (!have.length) {
  // Ambil definisi kolom stage persis dari schema.sql (satu sumber)
  const m = /(stage\s+TINYINT UNSIGNED GENERATED ALWAYS AS \(CASE[\s\S]*?END\) STORED)/.exec(sql);
  if (!m) throw new Error('definisi kolom stage tidak ditemukan di db/schema.sql');
  await conn.query('ALTER TABLE news_items ADD COLUMN ' + m[1] + ' AFTER link_error');
  await conn.query('ALTER TABLE news_items ADD KEY ix_company_stage (company_id, stage, sort_at), ADD KEY ix_stage_sort (stage, sort_at)');
  console.log('kolom stage + indeks siap.');
} else {
  // Kolom sudah ada: samakan definisinya dengan schema.sql (aturan lapis bisa berubah; aman diulang)
  await conn.query('ALTER TABLE news_items MODIFY COLUMN ' + defOf());
  console.log('kolom stage sudah ada: definisinya disamakan dengan schema.sql.');
}

const views = sql.split(';').map((x) => x.trim()).filter((x) => /^CREATE OR REPLACE VIEW/i.test(x));
for (const v of views) { await conn.query(v); console.log('view dibuat ulang:', /VIEW\s+(\w+)/i.exec(v)[1]); }

try {
  await conn.query("GRANT SELECT ON `media-search`.`news_relevant` TO 'mcp_ro'@'localhost'");
  console.log("hak baca news_relevant diberikan ke mcp_ro.");
} catch (e) {
  console.log('PERHATIAN: gagal memberi hak ke mcp_ro (' + e.message + '). Jalankan sebagai admin: GRANT SELECT ON `media-search`.`news_relevant` TO \'mcp_ro\'@\'localhost\';');
}
const [[c]] = await conn.query('SELECT COUNT(*) raw, SUM(stage >= 1) cleaned, SUM(stage = 2) relevan FROM news_items');
console.log('lapis data -> mentah:', c.raw, '| cleaned:', c.cleaned, '| relevan:', c.relevan);
await conn.end();
console.log('SELESAI. Restart server.');
