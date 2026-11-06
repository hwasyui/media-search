// Unmask semua berita yang belum punya alamat penerbit (article_url kosong), memakai skrip unmask buatan Anda APA ADANYA (src/listener/tools/unmask-url.js,
// googlenewsdecoder). Skrip ini hanya memanggilnya dan menyimpan hasilnya; tidak ada kode Anda yang diubah.
//
// Sumber tautan Google News yang didekode:
//   - baris yang found_url-nya masih tautan Google News: dipakai langsung
//   - baris yang found_url-nya tautan pencarian Google (tautan awal hilang): judulnya dicari ulang di Google News RSS untuk mendapat tautan Google-nya
// Hasil: article_url (+ source_domain) diisi, link_error dikosongkan, content_checked = 0 (supaya "Lengkapi data tersimpan" mengambil isinya).
// found_url dan url_hash TIDAK diubah. Aman diulang: hanya memproses yang masih kosong. Berhenti dengan Ctrl+C kapan saja.
//
//   node --env-file=.env scripts/links/unmask-all.js            (semua yang belum punya alamat penerbit)
//   node --env-file=.env scripts/links/unmask-all.js 20         (uji 20 baris)
//   node --env-file=.env scripts/links/unmask-all.js 0 telkom   (semua baris, satu perusahaan)
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { db } from '../../src/db/db.js';
import { googleLinkByTitle, isUsableArticleUrl } from '../../src/links/links.js';

const run = promisify(execFile);
const UNMASK_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/listener/tools/unmask-url.js');
const limit = Number(process.argv[2]) || 100000;
const company = process.argv[3] || null;
const GAP_MS = Number(process.env.GNEWS_GAP_MS) || 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let stop = false;
process.on('SIGINT', () => { stop = true; console.log('\n[unmask] berhenti setelah baris ini selesai...'); });

const [rows] = await db().query(
  `SELECT id, title, found_url, source_domain FROM news_items WHERE article_url IS NULL ${company ? 'AND company_id = ?' : ''}
     ORDER BY (found_url LIKE 'https://news.google.com/%') DESC, sort_at DESC LIMIT ?`,
  company ? [company, limit] : [limit],
);
console.log(`[unmask] ${rows.length} berita belum punya alamat penerbit`);

// Panggil skrip Anda; bila gagal karena pembatasan Google (429) tunggu dengan jeda yang makin panjang lalu coba lagi
async function decode(masked) {
  for (let n = 0; n < 4; n++) {
    let out;
    try {
      const { stdout } = await run(process.execPath, [UNMASK_SCRIPT, masked], { timeout: 30000, maxBuffer: 1024 * 1024 });
      out = JSON.parse(stdout.trim().split('\n').pop());
    } catch (e) { out = { success: false, message: String(e.message || e).slice(0, 120) }; }
    if (out.success && isUsableArticleUrl(out.decoded_url)) return { ok: true, url: out.decoded_url };
    if (!/429|too many|rate/i.test(String(out.message))) return { ok: false, why: out.message || 'gagal' };
    const wait = Math.min(120000, 8000 * 2 ** n);
    console.log(`[unmask] dibatasi Google (429), tunggu ${wait / 1000} dtk...`);
    await sleep(wait);
  }
  return { ok: false, why: '429 berulang' };
}

const stat = { ok: 0, noLink: 0, failed: 0, limited: 0 };
let streak429 = 0;                       // berapa baris berturut-turut kena 429 berulang: bila 3, jeda panjang (10 menit) lalu lanjut
let last = 0;
for (let i = 0; i < rows.length && !stop; i++) {
  const r = rows[i];
  const wait = last + GAP_MS - Date.now(); if (wait > 0) await sleep(wait); last = Date.now();
  let masked = /^https:\/\/news\.google\.com\//.test(r.found_url) ? r.found_url : null;
  if (!masked) { try { masked = await googleLinkByTitle(r.title, r.source_domain); } catch { masked = null; } }
  if (!masked) { stat.noLink++; await db().query("UPDATE news_items SET link_error = COALESCE(link_error, 'decode_gagal') WHERE id = ?", [r.id]); continue; }
  const d = await decode(masked);
  if (!d.ok && d.why === '429 berulang') {          // dibatasi Google: JANGAN ditandai gagal (nanti dicoba lagi di jalan berikutnya)
    stat.limited++; streak429++;
    if (streak429 >= 3) { console.log('[unmask] Google masih membatasi: jeda 10 menit sebelum lanjut...'); await sleep(600000); streak429 = 0; }
    continue;
  }
  streak429 = 0;
  if (d.ok) {
    let domain = null; try { domain = new URL(d.url).hostname.replace(/^www[.]/, ''); } catch { /* biarkan */ }
    await db().query('UPDATE news_items SET article_url = ?, source_domain = COALESCE(?, source_domain), link_error = NULL, content_checked = 0 WHERE id = ?', [d.url, domain, r.id]);
    stat.ok++;
  } else { stat.failed++; await db().query("UPDATE news_items SET link_error = 'decode_gagal' WHERE id = ?", [r.id]); }
  if ((i + 1) % 20 === 0) console.log(`[unmask] ${i + 1}/${rows.length}: ${stat.ok} berhasil, ${stat.failed} gagal didekode, ${stat.noLink} tautan Google tidak ditemukan, ${stat.limited} dilewati karena dibatasi Google`);
}
console.log(`[unmask] SELESAI: ${stat.ok} berhasil, ${stat.failed} gagal didekode, ${stat.noLink} tautan Google tidak ditemukan, ${stat.limited} dilewati karena dibatasi Google (dari ${rows.length}). Jalankan lagi nanti untuk sisanya.`);
const [[c]] = await db().query('SELECT SUM(stage = 0) mentah, SUM(stage >= 1) cleaned, SUM(stage = 2) relevan FROM news_items');
console.log(`[unmask] lapis data sekarang: mentah ${c.mentah}, cleaned ${c.cleaned}, relevan ${c.relevan}`);
process.exit(0);
