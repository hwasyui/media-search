// Penyelesai tautan Google News -> alamat artikel di situs penerbit.
// Google membatasi permintaan dekode (HTTP 429) bila banyak tautan didekode bersamaan. Karena itu semua permintaan lewat SATU antrean:
// satu per satu dengan jarak minimum, dan bila kena 429 semua permintaan berhenti sementara (cooldown) dengan jeda yang makin panjang.
// Hasil yang berhasil disimpan oleh pemanggil (kolom article_url) sehingga satu tautan hanya didekode sekali seumur hidup.
// Ekstraktor (extractor.js) tidak diubah: ia menerima alamat penerbit yang sudah jadi, jadi tidak perlu mendekode lagi.
import pkg from 'google-news-url-decoder';
const { GoogleDecoder } = pkg;

const decoder = new GoogleDecoder();
const GAP_MS = Number(process.env.GNEWS_GAP_MS) || 1500;        // jarak minimum antar permintaan
const COOLDOWN_BASE_MS = 8000, COOLDOWN_MAX_MS = 120000;
const sleep = (ms, signal) => new Promise((res) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
});

let last = 0, cooldownUntil = 0, streak = 0, chain = Promise.resolve();

export const isGoogleArticle = (u) => /^https:\/\/news\.google\.com\/(rss\/)?articles\//.test(u || '');
export const gnewsState = () => ({ cooldownMs: Math.max(0, cooldownUntil - Date.now()), streak });

async function attempt(url, { signal, fast, maxTries }) {
  for (let n = 0; n < maxTries; n++) {
    if (signal?.aborted) return { ok: false, reason: 'dibatalkan' };
    const cool = cooldownUntil - Date.now();
    if (cool > 0 && fast) return { ok: false, reason: 'decode_429' };         // pemanggil interaktif (klik pengguna): jangan menunggu lama
    const wait = Math.max(cooldownUntil, last + GAP_MS) - Date.now();
    if (wait > 0) await sleep(wait, signal);
    if (signal?.aborted) return { ok: false, reason: 'dibatalkan' };
    last = Date.now();
    let r;
    try { r = await decoder.decode(url); } catch (e) { r = { status: false, message: String(e?.message || e) }; }
    if (r?.status && r.decoded_url) { streak = 0; return { ok: true, url: r.decoded_url }; }
    if (/429/.test(String(r?.message || ''))) {
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
