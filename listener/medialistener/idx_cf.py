"""
IDX Cloudflare Bypass Scraper
Bypasses Cloudflare Managed Challenge on idx.co.id using stealth Chromium.
Rotates user-agents and caches session cookies to minimize overhead.
"""
import sys
import os
import json
import time
import random
import asyncio
from playwright.async_api import async_playwright

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0"
]

COOKIE_CACHE_PATH = os.path.join(os.path.dirname(__file__), ".idx_session.json")

def get_random_ua():
    return random.choice(USER_AGENTS)

async def run_idx_task(task_type, param):
    ua = get_random_ua()
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-gpu",
                "--disable-dev-shm-usage"
            ]
        )
        context = await browser.new_context(
            user_agent=ua,
            viewport={"width": 1366, "height": 768},
            locale="id-ID",
            timezone_id="Asia/Jakarta"
        )
        page = await context.new_page()
        await page.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.chrome = { runtime: {} };
        """)

        # Navigate to IDX home to establish Cloudflare clearance session
        await page.goto("https://www.idx.co.id/", timeout=30000, wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)

        result = None
        if task_type == "announcements":
            ticker = param.upper().strip()
            # Calculate 90 days range
            url = f"/primary/ListedCompany/GetAnnouncement?kodeEmiten={ticker}&indexFrom=0&pageSize=15&lang=id"
            data = await page.evaluate(f"""async () => {{
                try {{
                    const res = await fetch('{url}');
                    return await res.json();
                }} catch(e) {{
                    return {{ error: e.message }};
                }}
            }}""")
            replies = data.get("Replies", []) if isinstance(data, dict) else []
            items = []
            for r in replies:
                p = r.get("pengumuman") or {}
                items.append({
                    "date": (p.get("TglPengumuman") or "")[:10],
                    "title": p.get("JudulPengumuman") or "",
                    "type": p.get("JenisPengumuman") or p.get("PerihalPengumuman") or "Keterbukaan Informasi IDX",
                    "url": f"https://www.idx.co.id{p.get('PathAktif')}" if p.get("PathAktif") else (r.get("attachments", [{}])[0].get("FullSavePath") if r.get("attachments") else None)
                })
            result = items

        elif task_type == "search":
            q = param.strip()
            url = f"/primary/Search/GetSearch?keyword={q}&indexFrom=0&pageSize=15"
            data = await page.evaluate(f"""async () => {{
                try {{
                    const res = await fetch('{url}');
                    return await res.json();
                }} catch(e) {{
                    return {{ error: e.message }};
                }}
            }}""")
            items_raw = data.get("items", []) if isinstance(data, dict) else []
            companies = []
            seen = set()
            for item in items_raw:
                title = item.get("title", "").strip()
                snippet = item.get("snippet", "").strip()
                link = item.get("link", "")
                
                # Check if it has company code in title or link or snippet
                # Example: "Company Profiles - (ASII) Astra International Tbk"
                import re
                m = re.search(r'\(([A-Z0-9]{4})\)\s*([^)]*)', title + " " + snippet)
                if m:
                    code = m.group(1).upper()
                    name = m.group(2).strip() or title
                    if code not in seen:
                        seen.add(code)
                        companies.append({
                            "ticker": code,
                            "symbol": f"{code}.JK",
                            "name": name,
                            "exchange": "IDX (Bursa Efek Indonesia)",
                            "type": "public"
                        })
            result = companies

        await browser.close()
        return result

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python idx_cf.py <announcements|search> <param>"}))
        sys.exit(1)
    
    task_type = sys.argv[1].lower()
    param = sys.argv[2]
    
    try:
        res = asyncio.run(run_idx_task(task_type, param))
        print(json.dumps(res, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()

