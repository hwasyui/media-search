// Migrasi sekali jalan: catatan "juga dimuat di media lain" dipisah ke tabel sendiri (news_also), bukan kolom JSON di news_items, supaya news_items tidak gemuk dan
// catatannya bisa di-query (mis. berapa media kredibel yang memuat sebuah berita). Skrip ini:
//   1. membuat tabel news_also (hapus berita -> catatannya ikut terhapus otomatis lewat foreign key),
//   2. membuang kolom news_items.juga_dimuat bila ada (versi sebelumnya; datanya dipindah dulu ke news_also),
//   3. menambah indeks news_items.article_url (dipakai untuk menggabungkan kartu kembar di Beranda),
//   4. membuat ulang VIEW news_cleaned / news_relevant / v_company_overview (SELECT * membeku pada daftar kolom saat dibuat) dan memberi hak baca ke mcp_ro.
//   node --env-file=.env scripts/db/db-add-news-also.js        (aman diulang; lalu restart server)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbAdmin } from '../../src/db/db.js';

const conn = await dbAdmin();
await conn.query('USE `media-search`');
await conn.query(`CREATE TABLE IF NOT EXISTS news_also (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  news_id   BIGINT UNSIGNED NOT NULL,
  url_hash  BINARY(20) NOT NULL,
  domain    VARCHAR(255) CHARACTER SET ascii NULL,
  url       VARCHAR(2048) NOT NULL,
  title     VARCHAR(1000) NULL,
  tier      VARCHAR(20) CHARACTER SET ascii NULL,
  score     TINYINT UNSIGNED NULL,
  seen_at   DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_news_url (news_id, url_hash),
  KEY ix_news_tier (news_id, score),
  CONSTRAINT fk_also_news FOREIGN KEY (news_id) REFERENCES news_items(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB`);
console.log('tabel news_also siap.');

const [col] = await conn.query("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'media-search' AND TABLE_NAME = 'news_items' AND COLUMN_NAME = 'juga_dimuat'");
if (col.length) {
  const [rows] = await conn.query('SELECT id, juga_dimuat FROM news_items WHERE juga_dimuat IS NOT NULL');
  let moved = 0;
  for (const r of rows) {
    const list = typeof r.juga_dimuat === 'string' ? JSON.parse(r.juga_dimuat) : r.juga_dimuat;
    for (const e of Array.isArray(list) ? list : []) {
      if (!e?.url) continue;
      await conn.query('INSERT IGNORE INTO news_also (news_id, url_hash, domain, url, title, tier, score, seen_at) VALUES (?,?,?,?,?,?,?,?)',
        [r.id, createHash('sha1').update(e.url).digest(), e.domain || null, e.url, e.title || null, e.tier || null, e.score ?? null, e.at || null]);
      moved++;
    }
  }
  await conn.query('ALTER TABLE news_items DROP COLUMN juga_dimuat');
  console.log('kolom juga_dimuat dibuang dari news_items; ' + moved + ' catatan dipindah ke news_also.');
}

const [idx] = await conn.query("SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'media-search' AND TABLE_NAME = 'news_items' AND INDEX_NAME = 'ix_article'");
if (!idx.length) { await conn.query('ALTER TABLE news_items ADD KEY ix_article (article_url(191))'); console.log('indeks ix_article ditambahkan.'); }

const [idx2] = await conn.query("SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'media-search' AND TABLE_NAME = 'news_items' AND INDEX_NAME = 'ix_title'");
if (!idx2.length) { await conn.query('ALTER TABLE news_items ADD KEY ix_title (title_hash)'); console.log('indeks ix_title ditambahkan.'); }

const sql = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../db/schema.sql'), 'utf8').replace(/--[^\n]*/g, '');
const views = sql.split(';').map((x) => x.trim()).filter((x) => /^CREATE OR REPLACE VIEW (news_cleaned|news_relevant|v_company_overview)/i.test(x));
for (const v of views) { await conn.query(v); console.log('view dibuat ulang:', /VIEW\s+(\w+)/i.exec(v)[1]); }
for (const t of ['news_also', 'news_cleaned', 'news_relevant', 'v_company_overview']) {
  try { await conn.query("GRANT SELECT ON `media-search`.`" + t + "` TO 'mcp_ro'@'localhost'"); } catch (e) { console.log('PERHATIAN: gagal memberi hak ' + t + ' ke mcp_ro (' + e.message + ').'); }
}
console.log('hak baca diberikan ke mcp_ro.');
await conn.end();
console.log('SELESAI. Restart server.');
