// HTTP client yang menyamar sebagai browser asli (tanpa label bot, tanpa batasan robots.txt).
// Jeda per host antar request, ulang bila timeout/koneksi gagal/429/503.
import { decodeBytes, logger as log, sleep } from './util.js';

// User-Agent browser asli yang diacak per klien (padanan fake-useragent)
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
];

const uniform = (a, b) => a + Math.random() * (b - a);

export class HttpClient {
  constructor({ minDelay = 0.2, maxDelay = 0.6, timeout = 15.0, retries = 2, respectRobots = false } = {}) {
    Object.assign(this, { minDelay, maxDelay, timeout, retries, respectRobots });
    this.userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    this.headers = {
      'User-Agent': this.userAgent,
      'Accept-Language': 'id-ID,id;q=0.9,en;q=0.5',
      Accept: 'text/html,application/xhtml+xml,application/xml,application/rss+xml;q=0.9,*/*;q=0.5',
    };
    this._nextSlot = new Map();    // host -> waktu paling awal request berikutnya (ms)
    this._robots = new Map();      // origin -> daftar sitemap dari robots.txt
    log.info('HttpClient aktif. User-Agent: %s', this.userAgent);
  }

  // --- jeda per host antar request ---
  async _waitForSlot(host, minGap = 0) {
    if (this.maxDelay <= 0) return;
    const now = performance.now();
    const start = Math.max(now, this._nextSlot.get(host) ?? 0);
    const gap = Math.max(uniform(this.minDelay, this.maxDelay) * 1000, minGap * 1000);
    this._nextSlot.set(host, start + gap);
    if (start > now) await sleep(start - now);
  }

  async _rawGet(url, minGap = 0) {
    let host;
    try { host = new URL(url).host; } catch { log.warning('request error %s: URL tidak valid', url); return null; }
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      await this._waitForSlot(host, minGap);
      let res, content;
      try {
        res = await fetch(url, { headers: this.headers, redirect: 'follow', signal: AbortSignal.timeout(this.timeout * 1000) });
        content = Buffer.from(await res.arrayBuffer());
      } catch (e) {
        const code = e.cause?.code || '';
        if (code === 'ERR_INVALID_URL' || /Invalid URL|redirect/i.test(e.message)) {
          log.warning('request error %s: %s', url, e.message);
          return null;
        }
        log.warning('koneksi gagal (%s) %s, percobaan %d', e.name === 'TimeoutError' ? 'Timeout' : 'ConnectionError', url, attempt + 1);
        await sleep((1 + attempt) * 1000);
        continue;
      }
      if (res.status === 200) {
        const charset = (res.headers.get('content-type') || '').match(/charset=["']?([\w-]+)/i)?.[1];
        return { status: 200, url: res.url, headers: res.headers, content, get text() { return decodeBytes(content, charset); } };
      }
      if (res.status === 429 || res.status === 503) {
        const ra = res.headers.get('retry-after') || '';
        const wait = /^\d+$/.test(ra) ? Math.min(Number(ra), 30) : 2 * (attempt + 1);
        log.warning('HTTP %s dari %s, tunggu %ss', res.status, host, wait);
        await sleep(wait * 1000);
        continue;
      }
      log.info('HTTP %s %s (dilewati)', res.status, url);
      return null;
    }
    return null;
  }

  // --- sitemap helper (ambil link sitemap dari robots.txt jika ada) ---
  async sitemapsFromRobots(url) {
    const p = new URL(url);
    const base = `${p.protocol}//${p.host}`;
    let maps = this._robots.get(base);
    if (!maps) {
      const resp = await this._rawGet(`${base}/robots.txt`);
      maps = [];
      for (const line of (resp ? resp.text.split(/\r?\n/) : [])) {
        const m = line.split('#')[0].match(/^\s*sitemap\s*:\s*(\S+)/i);
        if (m) maps.push(m[1]);
      }
      this._robots.set(base, maps);
    }
    return [...maps];
  }

  /** Selalu true (bypass batasan bot robots.txt). */
  allowed() { return true; }

  /** GET langsung seperti browser biasa tanpa blokir robots.txt. null bila gagal. */
  get(url) { return this._rawGet(url); }
}

// Alias untuk kompatibilitas
export const PoliteSession = HttpClient;
