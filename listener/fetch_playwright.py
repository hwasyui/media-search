# Runner Playwright headless untuk bypass Cloudflare Managed Challenge & Anti-bot
import sys
from playwright.sync_api import sync_playwright

def fetch(url):
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                viewport={'width': 1280, 'height': 800}
            )
            page = context.new_page()
            page.goto(url, wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(2500)
            html = page.content()
            browser.close()
            return html
    except Exception:
        return ''

if __name__ == '__main__':
    if len(sys.argv) > 1:
        out = fetch(sys.argv[1])
        sys.stdout.buffer.write(out.encode('utf-8'))

