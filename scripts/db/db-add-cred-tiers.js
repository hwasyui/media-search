// Migrasi sekali jalan untuk DB yang sudah ada: tambah tingkat kredibilitas 'corporate' & 'aggregator' ke news_items.credibility_tier,
// lalu hitung ulang tingkat/skor/platform/jenis konten semua berita dari DOMAIN AKHIR (aturan tetap di src/risk/credibility.js & src/news/kind.js, bukan AI).
//   node scripts/db/db-add-cred-tiers.js
import { dbAdmin } from '../../src/db/db.js';
import { credibilityOf } from '../../src/risk/credibility.js';
import { contentKind, isUserGenerated, platformOf } from '../../src/news/kind.js';

const conn = await dbAdmin();
await conn.query("ALTER TABLE `media-search`.news_items MODIFY COLUMN credibility_tier ENUM('official','mainstream','corporate','aggregator','social_forum') NULL");
console.log('kolom credibility_tier siap (5 tingkat).');

const [rows] = await conn.query('SELECT id, source_domain d, platform p, content_kind k, credibility_tier t, credibility_score s FROM `media-search`.news_items WHERE source_domain IS NOT NULL');
let changed = 0;
for (const r of rows) {
  const c = credibilityOf('https://' + r.d + '/');
  const ugc = isUserGenerated({ domain: r.d });
  const cred = ugc && c.key !== 'official' ? { key: 'social_forum', score: 38 } : c;
  const plat = platformOf({ domain: r.d, tier: cred.key, ugc });
  const kind = r.k === 'konsumen' ? 'konsumen' : contentKind({ tier: cred.key, platform: plat });
  if (cred.key !== r.t || cred.score !== r.s || plat !== r.p || kind !== r.k) {
    await conn.query('UPDATE `media-search`.news_items SET credibility_tier = ?, credibility_score = ?, platform = ?, content_kind = ? WHERE id = ?', [cred.key, cred.score, plat, kind, r.id]);
    changed++;
  }
}
console.log('dihitung ulang: ' + changed + ' dari ' + rows.length + ' berita berubah.');
await conn.end();
