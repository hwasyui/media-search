"""Ekstraksi artikel + pembersihan boilerplate (iklan, menu, sidebar, embed sosmed, 'baca juga')."""
from __future__ import annotations

import json
import re
from collections import defaultdict
from typing import Optional

from bs4 import BeautifulSoup, Tag

from .models import Article, parse_date

# Tag yang hampir pasti bukan isi artikel.
_JUNK_TAGS = ["script", "style", "noscript", "iframe", "form", "nav", "aside", "footer", "header",
              "svg", "button", "template", "ins", "figure", "video", "audio", "select", "input"]

# Class/id penanda sampah (iklan, widget, share, komentar, rekomendasi, embed sosmed).
_JUNK_HINT = re.compile(
    r"(^|[\s_-])(ad|ads|adv|advert|advertisement|adsbygoogle|banner|sidebar|widget|related|share|sharing|social|"
    r"comment|comments|promo|newsletter|subscribe|breadcrumb|menu|navbar|popular|trending|terkait|bacajuga|baca-juga|"
    r"readmore|tagcloud|taglist|embed|twitter-tweet|instagram-media|tiktok-embed|fb-post|fb-video|overlay|modal|popup)"
    r"([\s_-]|$)", re.I)

# Baris yang jelas sampah walau berada di dalam badan artikel.
_JUNK_LINE = re.compile(
    r"^(baca juga|baca selengkapnya|simak juga|lihat juga|baca:|advertisement|iklan|scroll to continue|"
    r"klik di sini|ikuti kami|follow|bagikan|share|sumber:|editor:|penulis:|copyright|©|all rights reserved)\b", re.I)

# Urutan penyeleksi wadah artikel yang umum dipakai portal Indonesia.
_BODY_SELECTORS = [
    '[itemprop="articleBody"]', ".detail__body-text", ".read__content", ".article-content-body",
    ".entry-content", ".post-content", ".article-body", ".detail-content", ".content-detail", "article",
]

_ARTICLE_TYPES = ("article", "posting", "report")   # NewsArticle, BlogPosting, ReportageNewsArticle, dll


def _flatten_jsonld(data) -> list[dict]:
    if isinstance(data, list):
        return [x for d in data for x in _flatten_jsonld(d)]
    if isinstance(data, dict):
        items = [data]
        if "@graph" in data:
            items += _flatten_jsonld(data["@graph"])
        return items
    return []


def _author_name(val) -> str:
    if isinstance(val, str):
        return val.strip()
    if isinstance(val, dict):
        return str(val.get("name", "")).strip()
    if isinstance(val, list):
        return ", ".join(filter(None, (_author_name(v) for v in val)))
    return ""


def _metadata(soup: BeautifulSoup) -> dict:
    """Judul/tanggal/penulis dari JSON-LD, lalu OpenGraph/meta, lalu <time>."""
    meta: dict = {}
    for s in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(s.string or s.get_text() or "")
        except (json.JSONDecodeError, TypeError):
            continue
        for node in _flatten_jsonld(data):
            t = node.get("@type", "")
            t = " ".join(t) if isinstance(t, list) else str(t)
            if any(k in t.lower() for k in _ARTICLE_TYPES):
                meta.setdefault("title", node.get("headline"))
                meta.setdefault("published", node.get("datePublished") or node.get("dateCreated"))
                meta.setdefault("author", _author_name(node.get("author")))
                meta.setdefault("body", node.get("articleBody"))

    def m(*names):
        for n in names:
            tag = soup.find("meta", attrs={"property": n}) or soup.find("meta", attrs={"name": n})
            if tag and tag.get("content"):
                return tag["content"].strip()
        return None

    meta["title"] = meta.get("title") or m("og:title", "twitter:title") or (soup.title.string.strip() if soup.title and soup.title.string else "")
    meta["published"] = meta.get("published") or m("article:published_time", "pubdate", "publishdate", "date", "DC.date.issued")
    if not meta["published"]:
        t = soup.find("time", attrs={"datetime": True})
        meta["published"] = t["datetime"] if t else None
    meta["author"] = meta.get("author") or m("author", "article:author", "twitter:creator") or ""
    meta["description"] = m("og:description", "description") or ""
    meta["canonical"] = (soup.find("link", rel="canonical") or {}).get("href") if soup.find("link", rel="canonical") else None
    return meta


def _strip_junk(soup: BeautifulSoup) -> None:
    for tag in soup.find_all(_JUNK_TAGS):
        tag.decompose()
    for tag in soup.find_all(["blockquote"], class_=re.compile("twitter-tweet|instagram-media|tiktok-embed")):
        tag.decompose()
    # decompose() pada elemen induk membuat anak-anaknya jadi tag "mati" (attrs None); lewati yang sudah mati.
    for tag in soup.find_all(True):
        if tag.attrs is None or tag.name in ("html", "body", "article", "main"):
            continue
        hint = " ".join(tag.get("class", [])) + " " + (tag.get("id") or "")
        if hint.strip() and _JUNK_HINT.search(hint):
            tag.decompose()


def _paragraphs(container: Tag) -> list[str]:
    lines = []
    for p in container.find_all(["p", "li", "h2", "h3"]):
        text = re.sub(r"\s+", " ", p.get_text(" ", strip=True))
        if len(text) < 25 or _JUNK_LINE.match(text):
            continue
        if p.name == "li" and len(text) < 60:       # butir menu/daftar pendek
            continue
        lines.append(text)
    return lines


def _best_container(soup: BeautifulSoup) -> Optional[Tag]:
    for sel in _BODY_SELECTORS:
        el = soup.select_one(sel)
        if el and len(_paragraphs(el)) >= 2:
            return el
    # Fallback: induk dengan total teks paragraf terbanyak (kerapatan teks).
    scores: dict[int, float] = defaultdict(float)
    parents: dict[int, Tag] = {}
    for p in soup.find_all("p"):
        text = p.get_text(" ", strip=True)
        if len(text) < 40 or p.parent is None:
            continue
        link_len = sum(len(a.get_text()) for a in p.find_all("a"))
        scores[id(p.parent)] += len(text) - 2 * link_len       # penalti teks yang isinya link
        parents[id(p.parent)] = p.parent
    if not scores:
        return None
    return parents[max(scores, key=scores.get)]


def extract_article(html: bytes, url: str, snippet_chars: int = 1500) -> Optional[Article]:
    """HTML mentah -> Article, atau None bila tidak ditemukan isi artikel yang layak."""
    try:
        soup = BeautifulSoup(html, "lxml")
        meta = _metadata(soup)                    # ambil metadata SEBELUM membuang <script>/<header>
        _strip_junk(soup)
        container = _best_container(soup)
        paragraphs = _paragraphs(container) if container is not None else []
    except Exception:                             # struktur HTML tak terduga: lewati artikel ini saja
        return None

    text = "\n".join(paragraphs)
    if len(text) < 120:                           # fallback ke JSON-LD articleBody / meta description
        text = (meta.get("body") or meta.get("description") or text or "").strip()
    if len(text) < 60 or not meta.get("title"):
        return None

    snippet = text[:snippet_chars]
    if len(text) > snippet_chars:
        snippet = snippet.rsplit(" ", 1)[0] + "…"
    return Article(
        url=(meta.get("canonical") or url).strip(),
        title=re.sub(r"\s+", " ", meta["title"]).strip(),
        published=parse_date(meta.get("published")),
        author=meta.get("author") or "",
        text=text,
        snippet=snippet,
    )
