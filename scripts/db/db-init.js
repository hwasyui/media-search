// Membuat schema `media-search` + tabel, lalu mengisi companies dari data/companies.json (seed awal).
//   npm run db:init
//   npm run db:init -- --reset     (hapus & buat ulang schema media-search; menolak jika sudah ada berita, kecuali --force)
import { readFile } from 'node:fs/promises';
import { dbAdmin } from '../../src/db/db.js';

const sql = await readFile(new URL('../../db/schema.sql', import.meta.url), 'utf8');
const conn = await dbAdmin();

if (process.argv.includes('--reset')) {
  // Hanya menyentuh schema milik aplikasi ini, tidak pernah database lain.
  const [exists] = await conn.query("SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = 'media-search'");
  if (exists.length) {
    const [[{ n }]] = await conn.query('SELECT COUNT(*) n FROM `media-search`.news_items').catch(() => [[{ n: 0 }]]);
    if (n > 0 && !process.argv.includes('--force')) {
      console.error(`news_items berisi ${n} baris. Tambahkan --force untuk tetap menghapus.`);
      process.exit(1);
    }
    await conn.query('DROP DATABASE `media-search`');
    console.log('schema media-search lama dihapus.');
  }
}

for (const stmt of sql.split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean)) await conn.query(stmt);

const companies = JSON.parse(await readFile(new URL('../../data/companies.json', import.meta.url), 'utf8'));
for (const c of companies) {
  await conn.query(
    'INSERT INTO companies (id,name,type,ticker,sector,aliases) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),type=VALUES(type),ticker=VALUES(ticker),sector=VALUES(sector),aliases=VALUES(aliases)',
    [c.id, c.name, c.type || 'private', c.ticker || null, c.sector || null, JSON.stringify(c.aliases || [])],
  );
  for (const s of c.stakeholders || [])
    await conn.query('INSERT INTO stakeholders (company_id,name,role) VALUES (?,?,?) ON DUPLICATE KEY UPDATE role=VALUES(role)', [c.id, s.name, s.role || null]);
}
const [tables] = await conn.query('SHOW TABLES');
console.log('schema media-search siap. Tabel:', tables.map((t) => Object.values(t)[0]).join(', '));
console.log(`companies terisi: ${companies.length}`);
await conn.end();
