// TIDAK DIPAKAI aplikasi (disimpan sebagai arsip scraper headless browser Playwright; hanya lewat `main.js google-search`).
// Scrape hasil Google Search via headless Chromium (Playwright).
//
// Menjalankan browser Chrome/Chromium di latar belakang untuk merender JavaScript
// Google Search secara penuh hingga elemen hasil dan tautan media sosial
// (X.com, Instagram, Facebook, Reddit, TikTok, Threads, LinkedIn, YouTube, dll.) muncul di layar.
import { chromium } from 'playwright';
import { logger as log, sleep } from './util.js';

const SOCIAL_DOMAINS = ['x.com', 'twitter.com', 'instagram.com', 'facebook.com', 'fb.com', 'reddit.com', 'tiktok.com', 'threads.net', 'linkedin.com'];
const isSocial = (s) => SOCIAL_DOMAINS.some((d) => s.toLowerCase().includes(d));
const uniform = (a, b) => a + Math.random() * (b - a);

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Resolve redirect Google seperti /url?q=... atau /goto?url=... hanya untuk domain media sosial. */
async function resolveUrl(cookieHeader, href, timeout = 5000) {
  if (!href) return '';

  // Direct social link tidak perlu di-resolve
  if (isSocial(href) && !href.startsWith('https://www.google.')) return href;

  if (href.startsWith('/url?') || href.includes('google.com/url?')) {
    const qs = new URL(href, 'https://www.google.com').searchParams;
    const target = qs.get('q') || qs.get('url');
    if (target && target.startsWith('http')) {
      // Buang langsung jika target redirect bukan domain media sosial resmi
      return isSocial(target) ? target : '';
    }
  }

  // Handle /goto?url=... hanya jika berpotensi mengarah ke media sosial
  if (href.includes('/goto?')) {
    const get = (u) => fetch(u, { redirect: 'manual', headers: { 'User-Agent': USER_AGENT, Cookie: cookieHeader }, signal: AbortSignal.timeout(timeout) });
    try {
      const full = href.startsWith('http') ? href : new URL(href, 'https://www.google.com').href;
      const resp = await get(full);
      const loc = resp.headers.get('location');
      if (loc && isSocial(loc)) return loc;
      const body = await resp.text();
      if (resp.status === 200 && body.includes('<meta content=')) {
        const m = body.match(/url=([^"'\s>]+)/);
        if (m) {
          const r2 = await get(new URL(m[1], 'https://www.google.com').href);
          const loc2 = r2.headers.get('location');
          if (loc2 && isSocial(loc2)) return loc2;
        }
      }
    } catch { /* abaikan */ }
    return '';
  }

  return isSocial(href) ? href : '';
}

/** Cari di Google via browser headless Playwright dengan rendering JavaScript penuh. */
export async function searchGoogle(query, { maxResults = 40, days = 7, socialAll = true, xOnly = false } = {}) {
  // Pecah pencarian ke dalam 2 query terfokus (maks 3-4 domain per query)
  // agar tidak memicu filter bot Google akibat operator boolean bertumpuk
  const clean = query.trim();
  let queriesToRun;
  if (xOnly) queriesToRun = [`${clean} ("x.com" OR "twitter.com")`];
  else if (socialAll && !clean.includes('site:')) {
    queriesToRun = [
      `${clean} ("instagram.com" OR "tiktok.com" OR "x.com")`,
      `${clean} ("linkedin.com" OR "reddit.com" OR "threads.net" OR "facebook.com")`,
    ];
  } else queriesToRun = [clean];

  const rawCandidates = [];
  let cookies = [];
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox', '--disable-infobars', '--window-position=0,0', '--ignore-certificate-errors'],
  });
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT, locale: 'id-ID', viewport: { width: 1366, height: 768 } });

    // Pre-set consent cookie agar Google tidak memblokir dengan modal persetujuan
    await context.addCookies([{ name: 'SOCS', value: 'CAESHAgBEhJnd3NfMjAyNDA2MTAtMF9SQzIaAmlkIAEaBgiA_L20Bg', domain: '.google.com', path: '/' }]);
    const page = await context.newPage();

    // Samarkan browser agar semirip mungkin dengan pengguna nyata
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'languages', { get: () => ['id-ID', 'id', 'en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });

    try {
      let h3Elements = [];
      for (let idx = 0; idx < queriesToRun.length; idx++) {
        // Jika batch pertama sudah menghasilkan cukup kandidat, lewati batch kedua untuk menghemat request
        if (rawCandidates.length >= maxResults) break;
        if (idx > 0) await sleep(uniform(2000, 3500));

        await page.goto(`https://www.google.com/search?q=${encodeURIComponent(queriesToRun[idx]).replace(/%20/g, '+')}&hl=id&gl=ID`, { waitUntil: 'domcontentloaded', timeout: 25000 });

        // Cek apakah Google memicu halaman verifikasi bot (/sorry/)
        if (page.url().includes('/sorry/') || page.url().includes('google.com/sorry')) {
          log.warning('Google sementara memasang cooldown/CAPTCHA pada IP ini.');
          continue;
        }

        // Cek dan setujui dialog consent/cookie jika masih muncul
        for (const btnText of ['Saya setuju', 'Setuju semua', 'Accept all', 'I agree', 'Tolak semua']) {
          const btn = page.getByRole('button', { name: btnText });
          try {
            if (await btn.isVisible({ timeout: 800 })) {
              await btn.click();
              await page.waitForLoadState('domcontentloaded', { timeout: 3000 });
              break;
            }
          } catch { /* lanjut */ }
        }

        // Tunggu hasil pencarian muncul
        try { await page.waitForSelector("div#search, h3, div#rso, a[href*='/goto'], a[href*='/url']", { timeout: 10000 }); } catch { /* lanjut */ }

        // Jeda kecil dan scroll untuk rendering konten dinamis JavaScript
        await sleep(uniform(400, 800));
        try {
          await page.evaluate('window.scrollTo(0, document.body.scrollHeight / 2)');
          await sleep(300);
          await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
          await sleep(400);
        } catch { /* lanjut */ }

        // Ambil semua elemen h3 di halaman yang telah dirender
        h3Elements = await page.$$('h3');
      }

      for (const h3 of h3Elements) {
        try {
          const title = (await h3.innerText()).trim();
          if (!title || title.length < 2) continue;

          // Abaikan header internal Google (AI Overview, Peta, Penelusuran Terkait, dll.)
          const lower = title.toLowerCase();
          if (['balasan mode ai', 'ai overview', 'mode ai', 'peta', 'lokasi lainnya', 'orang lain juga menelusuri', 'penelusuran terkait', 'cuplikan pilihan'].some((bad) => lower.includes(bad))) continue;

          // Pastikan elemen bukan bagian dari widget AI Overview Google
          const isAiWidget = await h3.evaluate((el) => {
            const p = el.closest('[data-attrid], .xpdopen, [data-sokoban-container], [jsname="o6b0Le"]');
            return !!(p && (p.innerText.includes('Balasan Mode AI') || p.innerText.includes('AI Overview')));
          });
          if (isAiWidget) continue;

          // Cari tag <a> yang membungkus, berada di dalam, atau di dekat h3
          const href = await h3.evaluate((el) => {
            const a = el.closest('a') || el.querySelector('a') || (el.parentElement && el.parentElement.querySelector('a'));
            return a ? (a.href || a.getAttribute('href')) : null;
          });
          if (!href || href.startsWith('javascript:') || href.includes('google.com/search') || href.includes('google.com/preferences')) continue;

          // Strict pre-filter: jika direct link dan bukan domain media sosial, lewati langsung
          // agar tidak membuang waktu dan tidak memicu bot blocking Google dengan crawl yang tidak perlu
          const isRedirect = href.includes('/url?') || href.includes('/goto?');
          if (!isRedirect && !isSocial(href)) continue;

          // Cari container block dari elemen hasil, lalu snippet & tanggal di dalamnya
          const { snippet, date } = await h3.evaluate((el) => {
            const block = el.closest('div[data-hveid]') || el.closest('.g') || el.closest('.kb0PBd') || (el.parentElement && el.parentElement.parentElement);
            const pick = (sels) => {
              if (!block) return null;
              for (const s of sels) {
                const n = block.querySelector(s);
                if (n && n.innerText.trim()) return n.innerText.trim();
              }
              return null;
            };
            return {
              snippet: pick(['div[data-sncf]', 'span.VwiC3b', 'div.VwiC3b', 'div.yXK7lf', "div[style*='-webkit-line-clamp']"]) || '',
              date: pick(['span.MUxGbd.wuQ4Ob', 'span.LEwnzc', 'cite', 'span.f']),
            };
          });

          rawCandidates.push({ title, rawHref: href, snippet, date });
          if (rawCandidates.length >= maxResults * 2) break;
        } catch { continue; }
      }
    } finally {
      try { cookies = await context.cookies(); } catch { cookies = []; }
    }
  } finally {
    await browser.close();
  }

  if (!rawCandidates.length) return [];

  // Resolusi URL secara paralel dengan cookie sesi browser
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const resolved = new Array(rawCandidates.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(12, rawCandidates.length) }, async () => {
    while (next < rawCandidates.length) {
      const i = next++;
      resolved[i] = await resolveUrl(cookieHeader, rawCandidates[i].rawHref);
    }
  }));

  const results = [];
  const seen = new Set();
  rawCandidates.forEach((item, i) => {
    const finalUrl = resolved[i];
    if (results.length >= maxResults) return;
    if (!finalUrl || finalUrl.startsWith('/search?') || finalUrl.includes('/url?')) return;
    if (xOnly && !finalUrl.includes('x.com') && !finalUrl.includes('twitter.com')) return;
    // Pastikan hasil yang diambil HANYA berasal dari platform media sosial resmi
    if (socialAll && !isSocial(finalUrl)) return;
    if (seen.has(finalUrl)) return;
    seen.add(finalUrl);
    results.push({ title: item.title, url: finalUrl, snippet: item.snippet, date: item.date });
  });

  // Prioritaskan agar link media sosial muncul di urutan paling atas (urutan stabil)
  return results.sort((a, b) => (isSocial(a.url) ? 0 : 1) - (isSocial(b.url) ? 0 : 1));
}

// Jalankan langsung: node lib/googlePlaywright.js "telkom indonesia" [--x-only]
if (import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  const args = process.argv.slice(2);
  const q = args.filter((a) => !a.startsWith('-')).join(' ') || 'telkom indonesia';
  process.stderr.write(`Mencari via Playwright untuk: '${q}'...\n`);
  const data = await searchGoogle(q, { maxResults: 25, socialAll: true, xOnly: args.includes('--x-only') });
  console.log(JSON.stringify(data, null, 2));
  process.stderr.write(`\n${data.length} hasil ditemukan.\n`);
}
