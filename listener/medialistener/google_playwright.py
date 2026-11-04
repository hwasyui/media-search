# UNUSED (Disimpan sebagai arsip scraper headless browser Playwright)
"""Scrape hasil Google Search via headless Chromium (Playwright).

Menjalankan browser Chrome/Chromium di latar belakang untuk merender JavaScript
Google Search secara penuh hingga elemen hasil dan tautan media sosial
(X.com, Instagram, Facebook, Reddit, TikTok, Threads, LinkedIn, YouTube, dll.) muncul di layar.
"""
from __future__ import annotations

import json
import logging
import random
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import requests

SOCIAL_DOMAINS = [
    "x.com",
    "twitter.com",
    "instagram.com",
    "facebook.com",
    "fb.com",
    "reddit.com",
    "tiktok.com",
    "threads.net",
    "linkedin.com",
]

SOCIAL_QUERY_SITES = (
    '("x.com" OR "instagram.com" OR "facebook.com" OR '
    '"tiktok.com" OR "linkedin.com" OR "reddit.com" OR "threads.net")'
)


def _resolve_url(session: requests.Session, href: str, timeout: float = 5.0) -> str:
    """Resolve redirect Google seperti /url?q=... atau /goto?url=... hanya untuk domain media sosial."""
    if not href:
        return ""

    # Direct social link tidak perlu di-resolve
    if any(d in href.lower() for d in SOCIAL_DOMAINS) and not href.startswith("https://www.google."):
        return href

    if href.startswith("/url?") or "google.com/url?" in href:
        parsed = urllib.parse.urlparse(href)
        qs = urllib.parse.parse_qs(parsed.query)
        q_target = qs.get("q") or qs.get("url")
        if q_target and q_target[0].startswith("http"):
            target = q_target[0]
            # Buang langsung jika target redirect bukan domain media sosial resmi
            if any(d in target.lower() for d in SOCIAL_DOMAINS):
                return target
            return ""

    # Handle /goto?url=... hanya jika berpotensi mengarah ke media sosial
    if "/goto?" in href:
        full_url = href if href.startswith("http") else urllib.parse.urljoin("https://www.google.com", href)
        try:
            resp = session.get(full_url, allow_redirects=False, timeout=timeout)
            loc = resp.headers.get("Location")
            if loc and any(d in loc.lower() for d in SOCIAL_DOMAINS):
                return loc
            if resp.status_code == 200 and '<meta content=' in resp.text:
                import re
                m = re.search(r'url=([^"\'\s>]+)', resp.text)
                if m:
                    next_url = urllib.parse.urljoin("https://www.google.com", m.group(1))
                    r2 = session.get(next_url, allow_redirects=False, timeout=timeout)
                    loc2 = r2.headers.get("Location")
                    if loc2 and any(d in loc2.lower() for d in SOCIAL_DOMAINS):
                        return loc2
        except Exception:
            pass
        return ""

    return href if any(d in href.lower() for d in SOCIAL_DOMAINS) else ""


def search_google(query: str, max_results: int = 40, days: int = 7,
                  social_all: bool = True, x_only: bool = False) -> list[dict[str, Any]]:
    """Cari di Google via browser headless Playwright dengan rendering JavaScript penuh."""
    from playwright.sync_api import sync_playwright

    # Pecah pencarian ke dalam 2 query terfokus (maks 3-4 domain per query)
    # agar tidak memicu filter bot Google akibat operator boolean bertumpuk
    clean_query = query.strip()
    if x_only:
        queries_to_run = [f'{clean_query} ("x.com" OR "twitter.com")']
    elif social_all and "site:" not in clean_query:
        queries_to_run = [
            f'{clean_query} ("instagram.com" OR "tiktok.com" OR "x.com")',
            f'{clean_query} ("linkedin.com" OR "reddit.com" OR "threads.net" OR "facebook.com")',
        ]
    else:
        queries_to_run = [clean_query]

    results: list[dict[str, Any]] = []
    raw_candidates: list[dict[str, Any]] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-infobars",
                "--window-position=0,0",
                "--ignore-certificate-errors",
            ]
        )

        user_agent = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/126.0.0.0 Safari/537.36"
        )

        context = browser.new_context(
            user_agent=user_agent,
            locale="id-ID",
            viewport={"width": 1366, "height": 768},
        )

        # Pre-set consent cookie agar Google tidak memblokir dengan modal persetujuan
        context.add_cookies([
            {"name": "SOCS", "value": "CAESHAgBEhJnd3NfMjAyNDA2MTAtMF9SQzIaAmlkIAEaBgiA_L20Bg", "domain": ".google.com", "path": "/"},
        ])

        page = context.new_page()

        # Samarkan browser agar semirip mungkin dengan pengguna nyata
        page.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.chrome = { runtime: {} };
            Object.defineProperty(navigator, 'languages', { get: () => ['id-ID', 'id', 'en-US', 'en'] });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        """)

        try:
            for idx, q_text in enumerate(queries_to_run):
                # Jika batch pertama sudah menghasilkan cukup kandidat, lewati batch kedua untuk menghemat request
                if len(raw_candidates) >= max_results:
                    break

                if idx > 0:
                    time.sleep(random.uniform(2.0, 3.5))

                search_url = f"https://www.google.com/search?q={urllib.parse.quote_plus(q_text)}&hl=id&gl=ID"
                page.goto(search_url, wait_until="domcontentloaded", timeout=25_000)

                # Cek apakah Google memicu halaman verifikasi bot (/sorry/)
                if "/sorry/" in page.url or "google.com/sorry" in page.url:
                    logging.warning("Google sementara memasang cooldown/CAPTCHA pada IP ini.")
                    continue

                # Cek dan setujui dialog consent/cookie jika masih muncul
                for btn_text in ["Saya setuju", "Setuju semua", "Accept all", "I agree", "Tolak semua"]:
                    btn = page.get_by_role("button", name=btn_text)
                    try:
                        if btn.is_visible(timeout=800):
                            btn.click()
                            page.wait_for_load_state("domcontentloaded", timeout=3000)
                            break
                    except Exception:
                        pass

                # Tunggu hasil pencarian muncul
                try:
                    page.wait_for_selector("div#search, h3, div#rso, a[href*='/goto'], a[href*='/url']", timeout=10_000)
                except Exception:
                    pass

                # Jeda kecil dan scroll untuk rendering konten dinamis JavaScript
                time.sleep(random.uniform(0.4, 0.8))
                try:
                    page.evaluate("window.scrollTo(0, document.body.scrollHeight / 2)")
                    time.sleep(0.3)
                    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    time.sleep(0.4)
                except Exception:
                    pass

                # Ambil semua elemen h3 di halaman yang telah dirender
                h3_elements = page.query_selector_all("h3")

            for h3 in h3_elements:
                try:
                    title = h3.inner_text().strip()
                    if not title or len(title) < 2:
                        continue

                    # Abaikan header internal Google (AI Overview, Peta, Penelusuran Terkait, dll.)
                    t_lower = title.lower()
                    if any(bad in t_lower for bad in [
                        "balasan mode ai", "ai overview", "mode ai", "peta", "lokasi lainnya",
                        "orang lain juga menelusuri", "penelusuran terkait", "cuplikan pilihan"
                    ]):
                        continue

                    # Pastikan elemen bukan bagian dari widget AI Overview Google
                    is_ai_widget = h3.evaluate("""el => {
                        const p = el.closest('[data-attrid], .xpdopen, [data-sokoban-container], [jsname="o6b0Le"]');
                        if (p && (p.innerText.includes('Balasan Mode AI') || p.innerText.includes('AI Overview'))) return true;
                        return false;
                    }""")
                    if is_ai_widget:
                        continue

                    # Cari tag <a> yang membungkus, berada di dalam, atau di dekat h3
                    anchor = h3.evaluate_handle(
                        'el => el.closest("a") || el.querySelector("a") || (el.parentElement && el.parentElement.querySelector("a"))'
                    )
                    if not anchor or not anchor.as_element():
                        continue
                    a_el = anchor.as_element()
                    href = a_el.evaluate("a => a.href || a.getAttribute('href')") or ""
                    if not href or href.startswith("javascript:") or "google.com/search" in href or "google.com/preferences" in href:
                        continue

                    # Strict pre-filter: Jika direct link dan bukan domain media sosial, lewati langsung
                    # agar tidak membuang waktu dan tidak memicu bot blocking Google dengan crawl yang tidak perlu
                    is_redirect = "/url?" in href or "/goto?" in href
                    if not is_redirect and not any(d in href.lower() for d in SOCIAL_DOMAINS):
                        continue

                    # Cari container block dari elemen hasil
                    block_handle = h3.evaluate_handle(
                        'el => el.closest("div[data-hveid]") || el.closest(".g") || '
                        'el.closest(".kb0PBd") || el.parentElement.parentElement'
                    )
                    block_el = block_handle.as_element() if block_handle else None

                    snippet = ""
                    date = None
                    if block_el:
                        for s_sel in ["div[data-sncf]", "span.VwiC3b", "div.VwiC3b",
                                     "div.yXK7lf", "div[style*='-webkit-line-clamp']"]:
                            snip = block_el.query_selector(s_sel)
                            if snip and snip.inner_text().strip():
                                snippet = snip.inner_text().strip()
                                break

                        for d_sel in ["span.MUxGbd.wuQ4Ob", "span.LEwnzc", "cite", "span.f"]:
                            d_el = block_el.query_selector(d_sel)
                            if d_el and d_el.inner_text().strip():
                                date = d_el.inner_text().strip()
                                break

                    raw_candidates.append({
                        "title": title,
                        "raw_href": href,
                        "snippet": snippet,
                        "date": date,
                    })

                    if len(raw_candidates) >= max_results * 2:
                        break
                except Exception as e:
                    logging.debug("Error parsing item: %s", e)
                    continue

        finally:
            try:
                browser_cookies = context.cookies()
            except Exception:
                browser_cookies = []
            browser.close()

    if not raw_candidates:
        return []

    # Resolusi URL secara paralel dengan cookie sesi browser
    session = requests.Session()
    session.headers.update({"User-Agent": user_agent})
    for ck in browser_cookies:
        session.cookies.set(ck.get("name", ""), ck.get("value", ""), domain=ck.get("domain", ".google.com"))

    urls_to_resolve = [item["raw_href"] for item in raw_candidates]
    with ThreadPoolExecutor(max_workers=min(12, len(urls_to_resolve))) as pool:
        resolved_urls = list(pool.map(lambda u: _resolve_url(session, u), urls_to_resolve))

    seen_urls: set[str] = set()
    for item, final_url in zip(raw_candidates, resolved_urls):
        if not final_url or final_url.startswith("/search?") or "/url?" in final_url:
            continue

        if x_only and ("x.com" not in final_url and "twitter.com" not in final_url):
            continue

        # Pastikan hasil yang diambil HANYA berasal dari platform media sosial resmi
        if social_all and not any(d in final_url.lower() for d in SOCIAL_DOMAINS):
            continue

        if final_url in seen_urls:
            continue
        seen_urls.add(final_url)

        results.append({
            "title": item["title"],
            "url": final_url,
            "snippet": item["snippet"],
            "date": item["date"],
        })
        if len(results) >= max_results:
            break

    # Prioritaskan agar link media sosial (IG, X, FB, LinkedIn, TikTok, YouTube) muncul di urutan paling atas
    results.sort(key=lambda r: 0 if any(d in r["url"].lower() for d in SOCIAL_DOMAINS) else 1)
    return results


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    args = sys.argv[1:]
    q = " ".join([a for a in args if not a.startswith("-")]) or "telkom indonesia"
    x_flag = "--x-only" in args
    print(f"Mencari via Playwright untuk: '{q}'...", file=sys.stderr)
    data = search_google(q, max_results=25, social_all=True, x_only=x_flag)
    print(json.dumps(data, ensure_ascii=False, indent=2))
    print(f"\n{len(data)} hasil ditemukan.", file=sys.stderr)
