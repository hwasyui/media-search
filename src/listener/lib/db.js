// Koneksi MySQL untuk crawler. Kredensial dari environment (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD);
// bila belum ada (mis. dijalankan langsung dari terminal), dibaca dari ../.env milik aplikasi.
// Data ada di schema `media-search` (override: MEDIA_DB_NAME). Buat tabelnya sekali dengan `npm run db:init`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');
let pool;

function loadEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return;
  for (let line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const k = line.slice(0, line.indexOf('=')).trim();
    const v = line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
}

/** Pool bersama (tersambung ulang otomatis bila putus). */
export function connect() {
  if (!pool) {
    if (!process.env.DB_HOST) loadEnvFile();
    pool = mysql.createPool({
      host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER, password: process.env.DB_PASSWORD || '',
      database: process.env.MEDIA_DB_NAME || 'media-search',
      charset: 'utf8mb4', timezone: 'Z', connectTimeout: 15000,
      waitForConnections: true, connectionLimit: 8,
    });
    pool.pool.on('connection', (c) => c.query("SET time_zone = '+00:00'"));
  }
  return pool;
}

export async function closeDb() {
  if (pool) { await pool.end(); pool = null; }
}
