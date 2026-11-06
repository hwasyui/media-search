# Runner Playwright headless untuk bypass Cloudflare Managed Challenge & Anti-bot
import sys
from playwright.sync_api import sync_playwright

def fetch(url):
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=[
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-infobars',
                    '--window-position=0,0',
                    '--ignore-certificate-errors',
                    '--ignore-certificate-errors-spki-list',
                ]
            )
            context = browser.new_context(
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                viewport={'width': 1366, 'height': 768},
                locale='id-ID',
                timezone_id='Asia/Jakarta',
                extra_http_headers={
                    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"Windows"',
                }
            )
            context.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined});")
            page = context.new_page()
            try:
                page.goto(url, wait_until='domcontentloaded', timeout=18000)
                page.wait_for_timeout(3000)
            except Exception:
                pass
            
            # Ekstraksi paragraf langsung dari DOM ter-render (tembus Shadow DOM seperti MSN/SPA)
            paras = []
            try:
                paras = page.eval_on_selector_all('p', 'elements => elements.map(e => e.innerText.trim()).filter(Boolean)')
            except Exception:
                pass

            html = page.content()
            if paras and len(paras) >= 2:
                article_html = "".join(f"<p>{p}</p>\n" for p in paras if len(p) > 25)
                html = f"{html}\n<article class=\"extracted-dom-paras\">\n{article_html}\n</article>"

            browser.close()
            return html
    except Exception:
        return ''

if __name__ == '__main__':
    if len(sys.argv) > 1:
        out = fetch(sys.argv[1])
        sys.stdout.buffer.write(out.encode('utf-8'))

