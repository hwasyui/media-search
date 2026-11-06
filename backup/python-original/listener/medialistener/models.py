from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

from dateutil import parser as dateparser

WIB = timezone(timedelta(hours=7))


def parse_date(value) -> Optional[datetime]:
    """Parse berbagai format tanggal ke datetime UTC. Tanpa zona waktu dianggap WIB."""
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = dateparser.parse(str(value))
        except (ValueError, OverflowError, TypeError):
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=WIB)
    return dt.astimezone(timezone.utc)


@dataclass
class Candidate:
    """Link artikel yang ditemukan di RSS/sitemap/homepage, sebelum isi lengkapnya diambil."""
    url: str
    title: str = ""
    published: Optional[datetime] = None
    summary: str = ""
    author: str = ""
    tags: list[str] = field(default_factory=list)


@dataclass
class Article:
    url: str
    title: str
    published: Optional[datetime]
    author: str
    text: str            # teks lengkap (hanya di memori, dipakai untuk filter)
    snippet: str         # potongan teks yang disimpan ke database
