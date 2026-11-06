// IDX Cloudflare Bypass Scraper
// Bypasses Cloudflare Managed Challenge on idx.co.id using stealth Chromium.
// Rotates user-agents to minimize overhead.
// Pakai: node idx-cf.js <announcements|search> <param>   -> cetak JSON hasil
import { chromium } from 'playwright';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0',
];

const getRandomUa = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

// fetch JSON dari dalam halaman (membawa sesi Cloudflare yang sudah lolos)
const pageJson = (page, url) => page.evaluate(async (u) => {
  try {
    const res = await fetch(u);
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
}, url);

async function runIdxTask(taskType, param) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  try {
    const context = await browser.newContext({
      userAgent: getRandomUa(), viewport: { width: 1366, height: 768 }, locale: 'id-ID', timezoneId: 'Asia/Jakarta',
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
    });

    // Navigate to IDX home to establish Cloudflare clearance session
    await page.goto('https://www.idx.co.id/', { timeout: 30000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    let result = null;
    if (taskType === 'announcements') {
      const ticker = param.toUpperCase().trim();
      const data = await pageJson(page, `/primary/ListedCompany/GetAnnouncement?kodeEmiten=${ticker}&indexFrom=0&pageSize=15&lang=id`);
      const replies = data && !Array.isArray(data) && typeof data === 'object' ? (data.Replies || []) : [];
      result = replies.map((r) => {
        const p = r.pengumuman || {};
        return {
          date: (p.TglPengumuman || '').slice(0, 10),
          title: p.JudulPengumuman || '',
          type: p.JenisPengumuman || p.PerihalPengumuman || 'Keterbukaan Informasi IDX',
          url: p.PathAktif ? `https://www.idx.co.id${p.PathAktif}` : (r.attachments?.length ? (r.attachments[0]?.FullSavePath ?? null) : null),
        };
      });
    } else if (taskType === 'search') {
      const data = await pageJson(page, `/primary/Search/GetSearch?keyword=${param.trim()}&indexFrom=0&pageSize=15`);
      const itemsRaw = data && !Array.isArray(data) && typeof data === 'object' ? (data.items || []) : [];
      const companies = [];
      const seen = new Set();
      for (const item of itemsRaw) {
        const title = (item.title || '').trim();
        const snippet = (item.snippet || '').trim();
        // Contoh judul: "Company Profiles - (ASII) Astra International Tbk"
        const m = `${title} ${snippet}`.match(/\(([A-Z0-9]{4})\)\s*([^)]*)/);
        if (m) {
          const code = m[1].toUpperCase();
          const name = m[2].trim() || title;
          if (!seen.has(code)) {
            seen.add(code);
            companies.push({ ticker: code, symbol: `${code}.JK`, name, exchange: 'IDX (Bursa Efek Indonesia)', type: 'public' });
          }
        }
      }
      result = companies;
    }
    return result;
  } finally {
    await browser.close();
  }
}

if (process.argv.length < 4) {
  console.log(JSON.stringify({ error: 'Usage: node idx-cf.js <announcements|search> <param>' }));
  process.exit(1);
}
try {
  console.log(JSON.stringify(await runIdxTask(process.argv[2].toLowerCase(), process.argv[3])));
} catch (e) {
  console.log(JSON.stringify({ error: e.message }));
}
