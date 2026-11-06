// Migrasi sekali jalan: buang kolom news_items.status_line. Isinya teks template tetap (bukan hasil AI) dari golongan sumber dan kategori, tidak dipakai UI maupun alat MCP,
// dan teks lama yang sudah tersimpan tidak ikut berubah saat template diperbaiki. VIEW dibuat ulang dari db/schema.sql (SELECT * membeku pada daftar kolom saat dibuat).
//   node --env-file=.env scripts/db/db-drop-status-line.js        (aman diulang; restart server sesudahnya)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbAdmin } from '../../src/db/db.js';

const conn = await dbAdmin();
await conn.query('USE `media-search`');
const [col] = await conn.query("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'media-search' AND TABLE_NAME = 'news_items' AND COLUMN_NAME = 'status_line'");
if (col.length) {
  const [[c]] = await conn.query('SELECT COUNT(*) n, SUM(status_line IS NOT NULL) terisi FROM news_items');
  await conn.query('ALTER TABLE news_items DROP COLUMN status_line');
  console.log('kolom status_line dibuang (' + c.n + ' baris; ' + c.terisi + ' berisi teks template).');
} else console.log('kolom status_line sudah tidak ada.');

const sql = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../db/schema.sql'), 'utf8').replace(/--[^\n]*/g, '');
const views = sql.split(';').map((x) => x.trim()).filter((x) => /^CREATE OR REPLACE VIEW (news_cleaned|news_relevant|v_company_overview)/i.test(x));
for (const v of views) { await conn.query(v); console.log('view dibuat ulang:', /VIEW\s+(\w+)/i.exec(v)[1]); }
for (const t of ['news_cleaned', 'news_relevant', 'v_company_overview']) {
  try { await conn.query("GRANT SELECT ON `media-search`.`" + t + "` TO 'mcp_ro'@'localhost'"); } catch (e) { console.log('PERHATIAN: gagal memberi hak ' + t + ' ke mcp_ro (' + e.message + ').'); }
}
await conn.end();
console.log('SELESAI. Restart server.');
