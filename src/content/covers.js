// Cache gambar sampul berita di disk lokal (data/covers/<sha1 alamat>.<ext>) dan disajikan lewat /img/:id.
// Mengatasi gambar yang tidak termuat di browser karena situs penerbit memblokir hotlink, alamat kedaluwarsa, atau mixed content.
// Unduhan memakai permintaan biasa tanpa Referer dan tanpa menyamar; bila situs menolak, gambar itu tidak di-cache dan kartu memakai logo penerbit.
// Pengaman: hanya http(s), hanya tipe image/* (bukan SVG), maksimal 4 MB, timeout 8 dtk, dan alamat yang mengarah ke jaringan lokal/pribadi ditolak (SSRF).
import { createHash } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const COVERS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data/covers');
const EXT = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };
const MIME = Object.fromEntries([...new Set(Object.values(EXT))].map((e) => [e, Object.keys(EXT).find((k) => EXT[k] === e)]));
const MAX_BYTES = 4 * 1024 * 1024;
const inflight = new Map(), failed = new Map();                       // failed: alamat -> waktu gagal (jangan coba lagi selama 10 menit)

const hash = (u) => createHash('sha1').update(u).digest('hex');
function privateIp(ip) {
  if (net.isIPv6(ip)) return /^(::1|fe80|fc|fd|::ffff:(127|10|192\.168|172\.(1[6-9]|2\d|3[01])|169\.254))/i.test(ip) || ip === '::';
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}
async function assertPublic(u) {
  const url = new URL(u);
  if (!/^https?:$/.test(url.protocol)) throw new Error('protokol');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error('alamat pribadi');
}
async function cachedFile(h) {
  for (const ext of Object.keys(MIME)) { const f = path.join(COVERS_DIR, h + ext); try { await stat(f); return { file: f, type: MIME[ext] }; } catch { /* coba ekstensi lain */ } }
  return null;
}
async function download(url) {
  let cur = url;
  for (let hop = 0; hop < 4; hop++) {                                  // ikuti pengalihan manual agar setiap tujuan diperiksa
    await assertPublic(cur);
    const res = await fetch(cur, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; media-search/1.0)', Accept: 'image/*' }, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { cur = new URL(res.headers.get('location'), cur).toString(); continue; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!EXT[type]) throw new Error('bukan gambar');
    const chunks = []; let size = 0;
    for await (const c of res.body) { size += c.length; if (size > MAX_BYTES) throw new Error('terlalu besar'); chunks.push(c); }
    return { buf: Buffer.concat(chunks), ext: EXT[type] };
  }
  throw new Error('terlalu banyak pengalihan');
}

/** Kembalikan { file, type } gambar yang sudah di-cache (mengunduh bila belum), atau null bila tidak bisa. */
export async function getCover(imageUrl) {
  if (!imageUrl) return null;
  const h = hash(imageUrl);
  const hit = await cachedFile(h);
  if (hit) return hit;
  if (failed.has(h) && Date.now() - failed.get(h) < 600000) return null;
  if (!inflight.has(h)) {
    inflight.set(h, (async () => {
      try {
        const { buf, ext } = await download(imageUrl);
        await mkdir(COVERS_DIR, { recursive: true });
        const file = path.join(COVERS_DIR, h + ext);
        await writeFile(file, buf);
        return { file, type: MIME[ext] };
      } catch { failed.set(h, Date.now()); return null; }
      finally { inflight.delete(h); }
    })());
  }
  return inflight.get(h);
}
