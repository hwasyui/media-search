"""Semua fungsi SIMPAN ke MySQL untuk crawler, dipisah supaya bisa dipakai ulang dari mana saja.
(Padanan Python dari src/save.js.) Idempoten: menyimpan data yang sama dua kali tidak menggandakan baris."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Iterable, Optional

from .db import connect


def url_hash(url: str) -> bytes:
    return hashlib.sha1(url.encode("utf-8")).digest()


def to_utc_naive(iso: Optional[str]) -> Optional[datetime]:
    """ISO 8601 -> datetime UTC tanpa tzinfo (kolom DATETIME disimpan sebagai UTC)."""
    if not iso:
        return None
    try:
        d = datetime.fromisoformat(iso)
    except ValueError:
        return None
    return d.astimezone(timezone.utc).replace(tzinfo=None) if d.tzinfo else d


def save_article(url: str, title: str, *, published: Optional[str], author: Optional[str], domain: str,
                 category: str, source: str, snippet: Optional[str], matched: Iterable[str]) -> bool:
    """True kalau baru tersimpan, False kalau URL sudah ada."""
    with connect().cursor() as cur:
        cur.execute(
            "INSERT IGNORE INTO crawler_articles (url_hash,url,title,published_at,author,domain,category,source,snippet,matched)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (url_hash(url), url[:2048], (title or "")[:1000], to_utc_naive(published), (author or "")[:255] or None,
             (domain or "")[:255] or None, (category or "")[:40] or None, (source or "")[:255] or None,
             snippet, json.dumps(list(matched), ensure_ascii=False)),
        )
        return cur.rowcount == 1


def mark_seen(url: str) -> None:
    with connect().cursor() as cur:
        cur.execute("INSERT IGNORE INTO crawler_seen (url_hash) VALUES (%s)", (url_hash(url),))


def clear_seen() -> None:
    with connect().cursor() as cur:
        cur.execute("TRUNCATE TABLE crawler_seen")


def save_discovery(domain: str, found: dict) -> None:
    """Cache hasil auto-discovery RSS/sitemap per domain (sebelumnya data/discovered.json)."""
    with connect().cursor() as cur:
        cur.execute(
            "INSERT INTO crawler_discovery (domain,home,rss,sitemaps) VALUES (%s,%s,%s,%s)"
            " ON DUPLICATE KEY UPDATE home=VALUES(home), rss=VALUES(rss), sitemaps=VALUES(sitemaps)",
            (domain[:255], found.get("home"), json.dumps(found.get("rss", [])), json.dumps(found.get("sitemaps", []))),
        )
