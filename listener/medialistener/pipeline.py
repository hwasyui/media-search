"""Orkestrasi satu siklus crawl: sumber -> kandidat link -> ambil artikel -> bersihkan -> filter boolean -> simpan."""
from __future__ import annotations

import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

from .boolean_filter import BooleanQuery
from .discovery import discover
from .extractor import extract_article
from .http_client import PoliteSession
from .models import Article, Candidate
from .rss_crawler import fetch_rss
from .sitemap_crawler import fetch_homepage_links, fetch_sitemaps
from .storage import Storage

log = logging.getLogger("pipeline")


@dataclass
class Settings:
    max_age_days: float = 2.0
    max_per_source: int = 30
    fast: bool = False          # True: filter hanya dari judul+ringkasan RSS (tanpa download artikel yang tidak cocok)
    store_all: bool = False     # True: simpan semua artikel (gaya index Talkwalker), query dipakai hanya untuk label
    snippet_chars: int = 1500
    discovery_cache: str = "data/discovered.json"


_cache_lock = threading.Lock()


def _resolve(session: PoliteSession, source: dict, cfg: Settings, storage: Storage) -> dict:
    """Lengkapi rss/sitemaps sumber lewat auto-discovery (di-cache di MySQL, tabel crawler_discovery, supaya tidak diulang tiap siklus)."""
    if source.get("rss") or source.get("sitemaps") or not source.get("domain"):
        return source
    found = storage.get_discovery(source["domain"])
    if found is None:
        log.info("[%s] auto-discovery %s", source["name"], source["domain"])
        found = discover(session, source["domain"])
        storage.save_discovery(source["domain"], found)
    return {**source, "rss": found["rss"], "sitemaps": found["sitemaps"], "home": source.get("home") or found["home"]}


def _collect(session: PoliteSession, source: dict, cfg: Settings) -> tuple[list[Candidate], str]:
    """Jalur A (RSS) dulu; kalau kosong jatuh ke Jalur B (sitemap), lalu halaman utama."""
    cands: list[Candidate] = []
    for feed in source.get("rss", []):
        cands += fetch_rss(session, feed)
    path = "rss"
    if not cands and source.get("sitemaps"):
        cands, path = fetch_sitemaps(session, source["sitemaps"], cfg.max_age_days), "sitemap"
    if not cands:
        home = source.get("home") or (f"https://{source['domain']}/" if source.get("domain") else None)
        if home:
            cands, path = fetch_homepage_links(session, home), "homepage"
    return list({c.url: c for c in cands}.values()), path


def process_source(session: PoliteSession, storage: Storage, source: dict,
                   queries: dict[str, BooleanQuery], cfg: Settings) -> dict:
    stats = {"source": source["name"], "path": "-", "candidates": 0, "fetched": 0, "saved": 0, "error": None}
    try:
        source = _resolve(session, source, cfg, storage)
        cands, stats["path"] = _collect(session, source, cfg)
        since = datetime.now(timezone.utc) - timedelta(days=cfg.max_age_days)
        fresh = [c for c in cands if (c.published is None or c.published >= since) and not storage.is_seen(c.url)]
        fresh.sort(key=lambda c: c.published or since, reverse=True)       # terbaru dulu
        fresh = fresh[: cfg.max_per_source]
        stats["candidates"] = len(fresh)
        domain = urlparse(source.get("home") or "https://" + source.get("domain", "")).netloc.replace("www.", "")

        for c in fresh:
            try:
                # Pra-filter murah dari judul+ringkasan (mode fast); hemat request ke server situs.
                if cfg.fast and queries and not cfg.store_all:
                    pre = f"{c.title} {c.summary} {' '.join(c.tags)}"
                    if not any(q.matches(pre) for q in queries.values()):
                        storage.mark_seen(c.url)
                        continue
                resp = session.get(c.url)
                stats["fetched"] += 1
                art = extract_article(resp.content, c.url, cfg.snippet_chars) if resp is not None else None
                storage.mark_seen(c.url)
                if art is None and c.title and len(c.summary) >= 60:
                    # Halaman artikel diblok/tak terbaca (mis. 403): pakai ringkasan dari RSS yang memang dipublikasikan.
                    art = Article(url=c.url, title=c.title, published=c.published, author=c.author,
                                  text=c.summary, snippet=c.summary[: cfg.snippet_chars])
                if art is None:
                    continue
                art.published = art.published or c.published
                art.author = art.author or c.author
                if art.published and art.published < since:
                    continue
                full = f"{art.title} {art.text}"
                matched = [name for name, q in queries.items() if q.matches(full)]
                if queries and not matched and not cfg.store_all:
                    continue                                                  # real-time filtering: buang yang tak relevan
                if storage.save(art, domain=domain, category=source.get("category", "news"),
                                source=source["name"], matched=matched):
                    stats["saved"] += 1
                    log.info("[%s] + %s %s", source["name"], matched or "", art.title[:90])
            except Exception as e:            # satu artikel bermasalah tidak boleh menghentikan sumber ini
                log.warning("[%s] gagal proses %s: %s", source["name"], c.url, e)
    except Exception as e:
        stats["error"] = str(e)
        log.error("[%s] sumber gagal: %s", source.get("name"), e)
    return stats


def run_cycle(sources: list[dict], queries: dict[str, BooleanQuery], storage: Storage,
              session: PoliteSession, cfg: Settings, workers: int = 4) -> list[dict]:
    """Satu siklus. Paralel antar sumber (host berbeda); delay tetap berlaku per host di PoliteSession."""
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(process_source, session, storage, s, queries, cfg) for s in sources]
        return [f.result() for f in futures]
