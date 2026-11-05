// Penyelesai tautan Google News -> alamat artikel di situs penerbit.
// Google membatasi permintaan dekode (HTTP 429) bila banyak tautan didekode bersamaan. Karena itu semua permintaan lewat SATU antrean:
// satu per satu dengan jarak minimum, dan bila kena 429 semua permintaan berhenti sementara (cooldown) dengan jeda yang makin panjang.
// Hasil yang berhasil disimpan oleh pemanggil (kolom article_url) sehingga satu tautan hanya didekode sekali seumur hidup.
// Ekstraktor (extractor.js) tidak diubah: ia menerima alamat penerbit yang sudah jadi, jadi tidak perlu mendekode lagi.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from 'google-news-url-decoder';
const { GoogleDecoder } = pkg;

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UNMASK_SCRIPT = path.join(__dirname, '../listener/unmask_url.py');

const decoder = new GoogleDecoder();
const GAP_MS = Number(process.env.GNEWS_GAP_MS) || 800;        // jarak minimum antar permintaan
const COOLDOWN_BASE_MS = 5000, COOLDOWN_MAX_MS = 60000;
const sleep = (ms, signal) => new Promise((res) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
});

let last = 0, cooldownUntil = 0, streak = 0, chain = Promise.resolve();

export const isGoogleArticle = (u) => /^https:\/\/news\.google\.com\/(rss\/)?articles\//.test(u || '');
export const gnewsState = () => ({ cooldownMs: Math.max(0, cooldownUntil - Date.now()), streak });

async function decodeUrl(url) {
  // 1. Python decoder via googlenewsdecoder (Bughopper14 - tahan batchexecute token & bebas 429)
  try {
    const { stdout } = await execFileAsync('python', [UNMASK_SCRIPT, url], { timeout: 8000 });
    const parsed = JSON.parse(stdout.trim().split('\n').pop());
    if (parsed?.success && parsed.decoded_url && !parsed.decoded_url.includes('news.google.com')) {
      return { status: true, decoded_url: parsed.decoded_url };
    }
    if (parsed?.message) {
      return { status: false, message: parsed.message };
    }
  } catch {}

  // 2. Fallback internal node decoder
  try {
    return await decoder.decode(url);
  } catch (e) {
    return { status: false, message: String(e?.message || e) };
  }
}

async function attempt(url, { signal, fast, maxTries }) {
  for (let n = 0; n < maxTries; n++) {
    if (signal?.aborted) return { ok: false, reason: 'dibatalkan' };
    const cool = cooldownUntil - Date.now();
    if (cool > 0 && fast) return { ok: false, reason: 'decode_429' };         // pemanggil interaktif (klik pengguna): jangan menunggu lama
    const wait = Math.max(cooldownUntil, last + GAP_MS) - Date.now();
    if (wait > 0) await sleep(wait, signal);
    if (signal?.aborted) return { ok: false, reason: 'dibatalkan' };
    last = Date.now();
    let r = await decodeUrl(url);
    if (r?.status && r.decoded_url) { streak = 0; return { ok: true, url: r.decoded_url }; }
    if (/429|Too Many Requests/i.test(String(r?.message || ''))) {
      streak++;
      cooldownUntil = Date.now() + Math.min(COOLDOWN_MAX_MS, COOLDOWN_BASE_MS * 2 ** (streak - 1));
      continue;                                                                // coba lagi setelah cooldown
    }
    return { ok: false, reason: 'decode_gagal' };
  }
  return { ok: false, reason: 'decode_429' };
}

/** Selesaikan satu tautan. Mengembalikan { ok:true, url } atau { ok:false, reason: 'decode_429'|'decode_gagal'|'dibatalkan' }.
 *  opsi: signal (AbortSignal), fast (tidak menunggu cooldown, untuk klik pengguna), maxTries (default 3). */
export function resolveGoogleUrl(url, { signal, fast = false, maxTries = fast ? 1 : 3 } = {}) {
  if (fast) return attempt(url, { signal, fast, maxTries });                  // klik pengguna: langsung, tidak menunggu antrean job panjang
  const run = chain.then(() => attempt(url, { signal, fast, maxTries }));
  chain = run.catch(() => {});
  return run;
}
