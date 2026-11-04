"""Index lokal di MySQL (schema media-search). Penyimpanan ada di db_save.py; kelas ini menjaga antarmuka lama
(Storage.save/is_seen/mark_seen/search/stats) dan membaca dari tabel crawler_articles / crawler_seen."""
from __future__ import annotations

import json
from datetime import timezone
from typing import Iterable, Optional

import pymysql.cursors

from . import db_save
from .boolean_filter import BooleanQuery
from .db import connect
from .models import Article


def _iso(dt) -> Optional[str]:
    return dt.replace(tzinfo=timezone.utc).isoformat() if dt else None


class Storage:
    def __init__(self, path: str = ""):
        # `path` (--db) dipertahankan agar CLI lama tetap jalan, tetapi diabaikan: penyimpanan selalu MySQL.
        connect()          # gagal cepat bila kredensial/tabel belum siap

    # ── seen ───────────────────────────────────────────────────────────

    def is_seen(self, url: str) -> bool:
        with connect().cursor() as cur:
            cur.execute("SELECT 1 FROM crawler_seen WHERE url_hash = %s", (db_save.url_hash(url),))
            return cur.fetchone() is not None

    def mark_seen(self, url: str) -> None:
        db_save.mark_seen(url)

    def clear_seen(self) -> None:
        db_save.clear_seen()

    # ── simpan artikel ─────────────────────────────────────────────────

    def save(self, art: Article, *, domain: str, category: str, source: str, matched: Iterable[str]) -> bool:
        return db_save.save_article(
            art.url, art.title, published=art.published.isoformat() if art.published else None, author=art.author,
            domain=domain, category=category, source=source, snippet=art.snippet, matched=matched,
        )

    # ── cari di index ──────────────────────────────────────────────────

    def search(self, query: Optional[BooleanQuery] = None, *, category: Optional[str] = None,
               since: Optional[str] = None, limit: int = 50) -> list[dict]:
        """Terbaru dulu. SQL menyaring kategori dan tanggal; ekspresi boolean dievaluasi BooleanQuery (sintaks sama
        seperti sebelumnya) sambil membaca baris satu per satu sampai `limit` terpenuhi."""
        sql = ("SELECT url,title,published_at,author,domain,category,source,snippet,matched,fetched_at"
               " FROM crawler_articles WHERE 1=1")
        params: list = []
        if category:
            sql += " AND category = %s"
            params.append(category)
        if since:
            sql += " AND sort_at >= %s"
            params.append(db_save.to_utc_naive(since))
        sql += " ORDER BY sort_at DESC"
        out: list[dict] = []
        with connect().cursor(pymysql.cursors.SSDictCursor) as cur:     # streaming, tidak memuat seluruh tabel
            cur.execute(sql, params)
            for r in cur:
                if query is not None and not query.matches(f"{r['title'] or ''} {r['snippet'] or ''}"):
                    continue
                out.append({
                    "url": r["url"], "title": r["title"], "published": _iso(r["published_at"]), "author": r["author"],
                    "domain": r["domain"], "category": r["category"], "source": r["source"], "snippet": r["snippet"],
                    "matched": json.loads(r["matched"]) if r["matched"] else [], "fetched_at": _iso(r["fetched_at"]),
                })
                if len(out) >= limit:
                    break
        return out

    # ── cache auto-discovery ───────────────────────────────────────────

    def get_discovery(self, domain: str) -> Optional[dict]:
        with connect().cursor() as cur:
            cur.execute("SELECT home,rss,sitemaps FROM crawler_discovery WHERE domain = %s", (domain,))
            r = cur.fetchone()
        return {"home": r["home"], "rss": json.loads(r["rss"]), "sitemaps": json.loads(r["sitemaps"])} if r else None

    def save_discovery(self, domain: str, found: dict) -> None:
        db_save.save_discovery(domain, found)

    # ── statistik ──────────────────────────────────────────────────────

    def stats(self) -> dict:
        with connect().cursor() as cur:
            cur.execute("SELECT COUNT(*) n FROM crawler_articles")
            total = cur.fetchone()["n"]
            cur.execute("SELECT COALESCE(category,'unknown') k, COUNT(*) n FROM crawler_articles GROUP BY k")
            by_cat = {r["k"]: r["n"] for r in cur.fetchall()}
            cur.execute("SELECT COALESCE(source,'unknown') k, COUNT(*) n FROM crawler_articles GROUP BY k ORDER BY n DESC LIMIT 15")
            top_src = {r["k"]: r["n"] for r in cur.fetchall()}
        return {"total": total, "by_category": by_cat, "top_sources": top_src}
