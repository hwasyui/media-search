// Housekeeping cache gambar sampul (data/covers): buang file yatim (alamat gambarnya sudah tidak ada di news_items) dan jaga ukuran total di bawah batas.
// File yang dibuang tidak hilang permanen: gambar diunduh lagi otomatis bila beritanya ditampilkan.
import { createHash } from 'node:crypto';
import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { db } from '../db/db.js';
import { COVERS_DIR } from './covers.js';

const sha1 = (u) => createHash('sha1').update(u).digest('hex');
export const maxCoverBytes = () => Math.max(20, Number(process.env.COVERS_MAX_MB) || 300) * 1048576;
// Hasil pembersihan terakhir disimpan di globalThis: Next memuat modul ini terpisah per route, sehingga variabel modul tidak terlihat oleh route lain.
const state = (globalThis.__msCovers ??= { last: null, running: false });

async function listFiles() {
  let names = [];
  try { names = await readdir(COVERS_DIR); } catch { return []; }
  const out = [];
  for (const f of names) {
    try { const s = await stat(path.join(COVERS_DIR, f)); if (s.isFile()) out.push({ f, hash: f.split('.')[0], size: s.size, mtime: s.mtimeMs }); } catch { /* hilang di tengah jalan */ }
  }
  return out;
}

async function referenced() {
  const [rows] = await db().query("SELECT DISTINCT image_url FROM news_items WHERE image_url IS NOT NULL AND image_url <> ''");
  return new Set(rows.map((r) => sha1(r.image_url)));
}

export async function coverStats() {
  const [files, keep] = await Promise.all([listFiles(), referenced()]);
  const orphans = files.filter((x) => !keep.has(x.hash));
  return {
    files: files.length, bytes: files.reduce((a, x) => a + x.size, 0),
    orphans: orphans.length, orphanBytes: orphans.reduce((a, x) => a + x.size, 0),
    maxBytes: maxCoverBytes(), last: state.last, running: state.running,
  };
}

/** Hapus file yatim, lalu hapus yang paling lama diunduh sampai total <= 90% batas. */
export async function cleanCovers() {
  if (state.running) return { ...state.last, skipped: 'sedang berjalan' };
  state.running = true;
  try {
    const [files, keep] = await Promise.all([listFiles(), referenced()]);
    let removedOrphans = 0, removedOld = 0, freed = 0;
    const rm = async (x) => { try { await unlink(path.join(COVERS_DIR, x.f)); freed += x.size; return true; } catch { return false; } };
    const alive = [];
    for (const x of files) { if (!keep.has(x.hash)) { if (await rm(x)) removedOrphans++; } else alive.push(x); }
    let total = alive.reduce((a, x) => a + x.size, 0);
    const cap = maxCoverBytes();
    if (total > cap) {
      for (const x of alive.sort((a, b) => a.mtime - b.mtime)) {
        if (total <= cap * 0.9) break;
        if (await rm(x)) { removedOld++; total -= x.size; }
      }
    }
    state.last = { at: new Date().toISOString(), removedOrphans, removedOld, freedBytes: freed, filesAfter: files.length - removedOrphans - removedOld, bytesAfter: total };
    return state.last;
  } finally { state.running = false; }
}
