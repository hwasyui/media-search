"""Sekali jalan: pindahkan data lama (data/articles.db SQLite, data/discovered.json) ke MySQL.
Aman diulang (idempoten). File lama tidak dihapus.
    python migrate_to_mysql.py
"""
import json
import sqlite3
from pathlib import Path

from medialistener import db_save

DATA = Path(__file__).parent / "data"

n_art = n_seen = n_disc = 0
sqlite_path = DATA / "articles.db"
if sqlite_path.exists():
    con = sqlite3.connect(sqlite_path)
    con.row_factory = sqlite3.Row
    for r in con.execute("SELECT url,title,published,author,domain,category,source,snippet,matched FROM articles"):
        matched = json.loads(r["matched"]) if r["matched"] else []
        if db_save.save_article(r["url"], r["title"], published=r["published"], author=r["author"], domain=r["domain"],
                                category=r["category"], source=r["source"], snippet=r["snippet"], matched=matched):
            n_art += 1
    for (url,) in con.execute("SELECT url FROM seen"):
        db_save.mark_seen(url)
        n_seen += 1
    con.close()

disc_path = DATA / "discovered.json"
if disc_path.exists():
    for domain, found in json.loads(disc_path.read_text("utf-8")).items():
        db_save.save_discovery(domain, found)
        n_disc += 1

print(f"artikel baru: {n_art}, seen diproses: {n_seen}, domain discovery: {n_disc}")
