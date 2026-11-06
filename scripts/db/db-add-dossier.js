// Migrasi: buat tabel company_dossiers untuk dossier korporasi 4-bagian
//   node scripts/db/db-add-dossier.js
import { dbAdmin } from '../../src/db/db.js';

const conn = await dbAdmin();
await conn.query(`
  CREATE TABLE IF NOT EXISTS \`media-search\`.company_dossiers (
    company_id   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    content      JSON NOT NULL,
    PRIMARY KEY (company_id),
    CONSTRAINT fk_dossier_company FOREIGN KEY (company_id) REFERENCES \`media-search\`.companies(id) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB;
`);

console.log('Tabel company_dossiers siap!');
await conn.end();

