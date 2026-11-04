"""Jalur A: baca RSS/Atom feed dengan feedparser."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import feedparser
from bs4 import BeautifulSoup

from .http_client import PoliteSession
from .models import Candidate, parse_date

log = logging.getLogger("rss")


def _plain(html: str) -> str:
    if "<" not in (html or ""):                      # sudah teks biasa; hindari warning BeautifulSoup
        return (html or "").strip()
    return BeautifulSoup(html, "lxml").get_text(" ", strip=True)


def fetch_rss(session: PoliteSession, feed_url: str) -> list[Candidate]:
    """Download feed lewat session sopan (bukan feedparser langsung) lalu parse. [] bila gagal."""
    resp = session.get(feed_url)
    if resp is None:
        return []
    try:
        feed = feedparser.parse(resp.content)
    except Exception as e:  # feedparser jarang melempar, tapi jangan sampai satu feed rusak menghentikan semuanya
        log.warning("feed rusak %s: %s", feed_url, e)
        return []
    if feed.bozo and not feed.entries:
        log.info("bukan feed valid: %s", feed_url)
        return []

    out: list[Candidate] = []
    for e in feed.entries:
        url = (e.get("link") or "").strip()
        if not url:
            continue
        published = None
        for key in ("published_parsed", "updated_parsed"):
            if e.get(key):
                published = datetime(*e[key][:6], tzinfo=timezone.utc)   # feedparser sudah menormalkan ke UTC
                break
        if published is None:
            published = parse_date(e.get("published") or e.get("updated"))
        summary = _plain(e.get("summary", "") or (e.get("content") or [{}])[0].get("value", ""))
        out.append(Candidate(
            url=url,
            title=_plain(e.get("title", "")),
            published=published,
            summary=summary,
            author=e.get("author", "") or "",
            tags=[t.get("term", "") for t in e.get("tags", []) if t.get("term")],
        ))
    return out
