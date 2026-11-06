"""Auto-discovery: untuk domain apa pun (blog, forum, situs instansi) cari RSS dan sitemap-nya."""
from __future__ import annotations

import logging
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from .http_client import PoliteSession
from .rss_crawler import fetch_rss

log = logging.getLogger("discovery")

COMMON_FEED_PATHS = ["/feed", "/feed/", "/rss", "/rss.xml", "/atom.xml", "/feeds/posts/default", "/index.xml"]
COMMON_SITEMAP_PATHS = ["/news-sitemap.xml", "/sitemap_index.xml", "/sitemap.xml"]


def discover(session: PoliteSession, domain: str) -> dict:
    """Return {"rss": [...], "sitemaps": [...], "home": url}. Jumlah request dibatasi (tiap request kena delay)."""
    home = domain if domain.startswith("http") else f"https://{domain}/"
    rss: list[str] = []
    sitemaps: list[str] = []

    # 1) <link rel="alternate" type="application/rss+xml"> di halaman utama
    resp = session.get(home)
    if resp is not None:
        soup = BeautifulSoup(resp.content, "lxml")
        for link in soup.find_all("link", rel=lambda v: v and "alternate" in v):
            t = (link.get("type") or "").lower()
            if ("rss" in t or "atom" in t) and link.get("href"):
                rss.append(urljoin(home, link["href"]))

    # 2) sitemap yang diumumkan di robots.txt (sudah di-cache oleh session)
    sitemaps.extend(session.sitemaps_from_robots(home))

    # 3) tebak path umum hanya bila belum ketemu
    if not rss:
        for path in COMMON_FEED_PATHS:
            candidate = urljoin(home, path)
            if fetch_rss(session, candidate):          # valid kalau ada entry
                rss.append(candidate)
                break
    if not sitemaps:
        for path in COMMON_SITEMAP_PATHS:
            candidate = urljoin(home, path)
            r = session.get(candidate)
            if r is not None and (b"<urlset" in r.content[:2000] or b"<sitemapindex" in r.content[:2000]):
                sitemaps.append(candidate)
                break

    return {"home": home, "rss": list(dict.fromkeys(rss)), "sitemaps": list(dict.fromkeys(sitemaps))}
