// Sekali jalan: pindahkan data lama (data/articles.db SQLite, data/discovered.json) ke MySQL.
// Aman diulang (idempoten). File lama tidak dihapus.
//     node tools/migrate-to-mysql.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { closeDb } from '../lib/db.js';
import * as dbSave from '../lib/dbSave.js';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');

let nArt = 0, nSeen = 0, nDisc = 0;
const sqlitePath = path.join(DATA, 'articles.db');
if (fs.existsSync(sqlitePath)) {
  const con = new DatabaseSync(sqlitePath, { readOnly: true });
  for (const r of con.prepare('SELECT url,title,published,author,domain,category,source,snippet,matched FROM articles').all()) {
    const matched = r.matched ? JSON.parse(r.matched) : [];
    if (await dbSave.saveArticle(r.url, r.title, {
      published: r.published, author: r.author, domain: r.domain, category: r.category, source: r.source, snippet: r.snippet, matched,
    })) nArt++;
  }
  for (const { url } of con.prepare('SELECT url FROM seen').all()) {
    await dbSave.markSeen(url);
    nSeen++;
  }
  con.close();
}

const discPath = path.join(DATA, 'discovered.json');
if (fs.existsSync(discPath)) {
  for (const [domain, found] of Object.entries(JSON.parse(fs.readFileSync(discPath, 'utf8')))) {
    await dbSave.saveDiscovery(domain, found);
    nDisc++;
  }
}

console.log(`artikel baru: ${nArt}, seen diproses: ${nSeen}, domain discovery: ${nDisc}`);
await closeDb();
