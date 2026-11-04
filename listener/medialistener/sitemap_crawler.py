"""Jalur B: fallback bila RSS tidak ada. Baca sitemap (termasuk news-sitemap), lalu halaman utama."""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from .http_client import PoliteSession
from .models import Candidate, parse_date

log = logging.getLogger("sitemap")

# Bagian URL yang bukan artikel (halaman indeks, tag, penulis, pencarian, dll).
_NON_ARTICLE = re.compile(r"/(tag|tags|topic|topik|category|kategori|author|penulis|page|search|cari|login|register|"
                          r"about|kontak|contact|redaksi|pedoman|privacy|terms|rss|feed|indeks|index)(/|$|\?)", re.I)
_ASSET = re.compile(r"\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|mp3|css|js|xml)(\?|$)", re.I)


def _looks_like_article(url: str, base_host: str) -> bool:
    p = urlparse(url)
    if p.netloc.replace("www.", "") != base_host.replace("www.", ""):
        return False
    path = p.path.strip("/")
    if not path or _NON_ARTICLE.search(p.path + "/") or _ASSET.search(url):
        return False
    last = path.split("/")[-1]
    # artikel biasanya: slug panjang bertanda hubung, atau mengandung id angka / tanggal
    return ("-" in last and len(last) > 20) or bool(re.search(r"\d{5,}", path)) or bool(re.search(r"/20\d\d/\d\d/", p.path))


def _parse_sitemap_xml(session: PoliteSession, url: str, since: datetime, depth: int = 0) -> list[Candidate]:
    resp = session.get(url)
    if resp is None:
        return []
    soup = BeautifulSoup(resp.content, "xml")
    out: list[Candidate] = []

    if soup.find("sitemapindex"):
        if depth >= 2:
            return []
        children = []
        for sm in soup.find_all("sitemap"):
            loc = sm.find("loc")
            lastmod = parse_date(sm.find("lastmod").text) if sm.find("lastmod") else None
            if loc and (lastmod is None or lastmod >= since):
                children.append((lastmod or datetime.min.replace(tzinfo=timezone.utc), loc.text.strip()))
        children.sort(reverse=True)                      # sitemap terbaru dulu
        for _, child in children[:3]:                    # batasi supaya tidak menelusuri ratusan file arsip
            out.extend(_parse_sitemap_xml(session, child, since, depth + 1))
        return out

    for u in soup.find_all("url"):
        loc = u.find("loc")
        if not loc:
            continue
        news_date = u.find("news:publication_date") or u.find("publication_date")
        news_title = u.find("news:title") or u.find("title")
        date_tag = news_date or u.find("lastmod")
        date = parse_date(date_tag.text) if date_tag else None
        if date is not None and date < since:
            continue
        out.append(Candidate(url=loc.text.strip(), title=news_title.text.strip() if news_title else "", published=date))
    return out


def fetch_sitemaps(session: PoliteSession, sitemap_urls: list[str], max_age_days: float) -> list[Candidate]:
    since = datetime.now(timezone.utc) - timedelta(days=max_age_days)
    out: list[Candidate] = []
    for url in sitemap_urls:
        try:
            out.extend(_parse_sitemap_xml(session, url, since))
        except Exception as e:   # struktur XML aneh jangan menghentikan sumber lain
            log.warning("sitemap error %s: %s", url, e)
    # Sitemap sering memuat halaman indeks (tag, topik, kategori, file); buang yang jelas bukan artikel.
    return [c for c in out if not (_NON_ARTICLE.search(urlparse(c.url).path + "/") or _ASSET.search(c.url))]


def fetch_homepage_links(session: PoliteSession, home_url: str) -> list[Candidate]:
    """Pilihan terakhir: ambil link yang tampak seperti artikel dari halaman utama."""
    resp = session.get(home_url)
    if resp is None:
        return []
    soup = BeautifulSoup(resp.content, "lxml")
    host = urlparse(home_url).netloc
    seen, out = set(), []
    for a in soup.find_all("a", href=True):
        url = urljoin(home_url, a["href"]).split("#")[0]
        title = a.get_text(" ", strip=True)
        if url in seen or len(title) < 20 or not _looks_like_article(url, host):
            continue
        seen.add(url)
        out.append(Candidate(url=url, title=title))
    return out
