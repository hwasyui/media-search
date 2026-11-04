// Koneksi MySQL. Kredensial dari .env (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD).
// Data aplikasi ini ada di schema sendiri `media-search` (DB_NAME di .env dipakai database lain, tidak disentuh).
import mysql from 'mysql2/promise';

export const SCHEMA = process.env.MEDIA_DB_NAME || 'media-search';
const base = () => ({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, connectTimeout: 15000,
  charset: 'utf8mb4', timezone: 'Z',
});

let pool;
export function db() {
  if (!pool) {
    pool = mysql.createPool({ ...base(), database: SCHEMA, waitForConnections: true, connectionLimit: 8 });
    pool.on('connection', (c) => c.query("SET time_zone = '+00:00'"));   // semua waktu UTC
  }
  return pool;
}

// Koneksi tanpa database terpilih, hanya untuk membuat schema (db:init)
export async function dbAdmin() {
  const c = await mysql.createConnection(base());
  await c.query("SET time_zone = '+00:00'");
  return c;
}
