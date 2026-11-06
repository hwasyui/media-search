"""CLI Media Listener.

  python main.py crawl                          # satu siklus, pakai sources.json + queries.txt
  python main.py crawl --loop 15                # ulangi tiap 15 menit
  python main.py crawl -q "korupsi AND BUMN" --category news,blog
  python main.py search "banjir AND (Jakarta OR Bekasi)" --since 2026-11-01
  python main.py discover kompasiana.com        # cek RSS/sitemap sebuah domain
  python main.py stats
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Pastikan output konsol selalu UTF-8 agar emoji dan karakter khusus di sosmed tidak crash di Windows
if sys.stdout.encoding != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from medialistener.boolean_filter import BooleanQuery, parse_queries
from medialistener.discovery import discover
from medialistener.http_client import PoliteSession
from medialistener.pipeline import Settings, run_cycle
from medialistener.storage import Storage


def load_queries(args) -> dict:
    specs = list(args.query or [])
    qfile = Path(args.queries_file)
    if qfile.exists() and not args.query:
        specs += qfile.read_text("utf-8").splitlines()
    return parse_queries(specs)


def cmd_crawl(args) -> None:
    sources = [s for s in json.loads(Path(args.sources).read_text("utf-8")) if s.get("enabled", True)]
    if args.category:
        wanted = set(args.category.split(","))
        sources = [s for s in sources if s.get("category", "news") in wanted]
    if args.only:
        sources = [s for s in sources if s["name"] in set(args.only.split(","))]
    queries = load_queries(args)
    if not queries and not args.store_all:
        sys.exit("Tidak ada query. Isi queries.txt, pakai -q, atau tambahkan --store-all.")

    storage = Storage(args.db)
    if args.reset_seen:
        storage.clear_seen()
    session = PoliteSession(min_delay=args.min_delay, max_delay=args.max_delay)
    cfg = Settings(max_age_days=args.max_age_days, max_per_source=args.max_per_source,
                   fast=args.fast, store_all=args.store_all)
    logging.info("%d sumber, %d query: %s", len(sources), len(queries), list(queries))

    while True:
        started = time.time()
        results = run_cycle(sources, queries, storage, session, cfg, workers=args.workers)
        saved = sum(r["saved"] for r in results)
        logging.info("Siklus selesai %.0fs: %d artikel baru tersimpan", time.time() - started, saved)
        for r in results:
            flag = f"ERROR {r['error']}" if r["error"] else ""
            logging.info("  %-18s via %-8s kandidat=%-3d diunduh=%-3d tersimpan=%-3d %s",
                         r["source"], r["path"], r["candidates"], r["fetched"], r["saved"], flag)
        if not args.loop:
            break
        logging.info("Tidur %d menit...", args.loop)
        time.sleep(args.loop * 60)


def cmd_search(args) -> None:
    storage = Storage(args.db)
    since = None
    if args.since:
        since = datetime.fromisoformat(args.since).replace(tzinfo=timezone.utc).isoformat()
    elif args.days:
        since = (datetime.now(timezone.utc) - timedelta(days=args.days)).isoformat()
    rows = storage.search(BooleanQuery(args.expression) if args.expression else None,
                          category=args.category, since=since, limit=args.limit)
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return
    for r in rows:
        print(f"[{(r['published'] or '-')[:16]}] ({r['category']}/{r['source']}) {r['title']}\n    {r['url']}")
    print(f"\n{len(rows)} hasil")


def cmd_discover(args) -> None:
    session = PoliteSession(min_delay=args.min_delay, max_delay=args.max_delay)
    print(json.dumps(discover(session, args.domain), indent=2))


def cmd_stats(args) -> None:
    print(json.dumps(Storage(args.db).stats(), indent=2, ensure_ascii=False))


def cmd_google_search(args) -> None:
    from medialistener.google_playwright import search_google
    results = search_google(args.query, max_results=args.limit, days=args.days,
                          social_all=not args.x_only, x_only=args.x_only)
    print(json.dumps(results, ensure_ascii=False))


def main() -> None:
    ap = argparse.ArgumentParser(description="Media Listener lokal")
    ap.add_argument("--db", default="data/articles.db")
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("crawl")
    c.add_argument("--sources", default="sources.json")
    c.add_argument("--queries-file", default="queries.txt")
    c.add_argument("-q", "--query", action="append", help="'nama: ekspresi' atau 'ekspresi' (boleh berulang)")
    c.add_argument("--category", help="mis. news,blog,forum")
    c.add_argument("--only", help="nama sumber, pisah koma")
    c.add_argument("--loop", type=int, default=0, help="ulangi tiap N menit (0 = sekali)")
    c.add_argument("--max-age-days", type=float, default=2.0)
    c.add_argument("--max-per-source", type=int, default=30)
    c.add_argument("--workers", type=int, default=4)
    c.add_argument("--min-delay", type=float, default=2.0)
    c.add_argument("--max-delay", type=float, default=5.0)
    c.add_argument("--fast", action="store_true", help="filter dari judul+ringkasan RSS saja (lebih hemat request)")
    c.add_argument("--store-all", action="store_true", help="simpan semua artikel, bukan hanya yang cocok query")
    c.add_argument("--reset-seen", action="store_true", help="lupakan URL yang pernah dilewati")
    c.set_defaults(fn=cmd_crawl)

    s = sub.add_parser("search")
    s.add_argument("expression", nargs="?", default="")
    s.add_argument("--category")
    s.add_argument("--since", help="YYYY-MM-DD")
    s.add_argument("--days", type=int)
    s.add_argument("--limit", type=int, default=50)
    s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_search)

    d = sub.add_parser("discover")
    d.add_argument("domain")
    d.add_argument("--min-delay", type=float, default=2.0)
    d.add_argument("--max-delay", type=float, default=5.0)
    d.set_defaults(fn=cmd_discover)

    st = sub.add_parser("stats")
    st.set_defaults(fn=cmd_stats)

    gs = sub.add_parser("google-search", help="Cari Google via headless browser")
    gs.add_argument("query")
    gs.add_argument("--limit", type=int, default=30)
    gs.add_argument("--days", type=int, default=7)
    gs.add_argument("--x-only", action="store_true", help="Filter hanya hasil dari x.com/twitter.com")
    gs.add_argument("--json", action="store_true", help="Format output JSON")
    gs.set_defaults(fn=cmd_google_search)

    args = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)-7s %(message)s", datefmt="%H:%M:%S")
    try:
        args.fn(args)
    except KeyboardInterrupt:
        print("\nDihentikan.")
    except ValueError as e:                # mis. sintaks boolean salah
        sys.exit(f"Error: {e}")


if __name__ == "__main__":
    main()
