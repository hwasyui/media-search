// Migrasi sekali jalan untuk DB yang sudah ada: tambah kolom extra_queries (query pencarian tambahan per perusahaan) ke companies.
//   node scripts/db/db-add-extra-queries.js
import { dbAdmin } from '../../src/db/db.js';

const conn = await dbAdmin();
const [have] = await conn.query("SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'media-search' AND TABLE_NAME = 'companies' AND COLUMN_NAME = 'extra_queries'");
if (!have.length) await conn.query('ALTER TABLE `media-search`.companies ADD COLUMN extra_queries JSON NULL AFTER aliases');
console.log('kolom extra_queries siap.');
await conn.end();
