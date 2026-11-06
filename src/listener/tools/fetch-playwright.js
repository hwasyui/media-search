// Runner Playwright headless untuk bypass Cloudflare Managed Challenge & Anti-bot.
// Pakai: node fetch-playwright.js <url>   (HTML ditulis ke stdout sebagai UTF-8; kosong bila gagal)
import { chromium } from 'playwright';

async function fetchHtml(url) {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-position=0,0',
        '--ignore-certificate-errors',
        '--ignore-certificate-errors-spki-list',
      ],
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      locale: 'id-ID',
      timezoneId: 'Asia/Jakarta',
      extraHTTPHeaders: {
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      },
    });
    await context.addInitScript("Object.defineProperty(navigator, 'webdriver', {get: () => undefined});");
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 18000 });
      await page.waitForTimeout(3000);
    } catch { /* lanjut dengan apa yang sudah termuat */ }

    // Ekstraksi paragraf langsung dari DOM ter-render (tembus Shadow DOM seperti MSN/SPA)
    let paras = [];
    try {
      paras = await page.$$eval('p', (els) => els.map((e) => e.innerText.trim()).filter(Boolean));
    } catch { /* abaikan */ }

    let html = await page.content();
    if (paras.length >= 2) {
      const articleHtml = paras.filter((p) => p.length > 25).map((p) => `<p>${p}</p>\n`).join('');
      html = `${html}\n<article class="extracted-dom-paras">\n${articleHtml}\n</article>`;
    }
    return html;
  } catch {
    return '';
  } finally {
    await browser?.close().catch(() => {});
  }
}

if (process.argv[2]) process.stdout.write(Buffer.from(await fetchHtml(process.argv[2]), 'utf8'));
