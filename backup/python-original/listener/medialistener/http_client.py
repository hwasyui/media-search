from __future__ import annotations

import logging
import random
import threading
import time
from typing import Optional
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import requests
from fake_useragent import UserAgent

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("http")


class HttpClient:
    """HTTP Client berbasis requests yang menyamar sebagai browser asli (tanpa label bot & tanpa batasan santai)."""

    def __init__(self, min_delay: float = 0.2, max_delay: float = 0.6, timeout: float = 15.0,
                 retries: int = 2, respect_robots: bool = False):
        self.min_delay, self.max_delay = min_delay, max_delay
        self.timeout, self.retries, self.respect_robots = timeout, retries, respect_robots
        self.session = requests.Session()
        
        # User-Agent murni browser asli (tanpa embel-embel nama bot)
        try:
            self.ua_generator = UserAgent()
            self.user_agent = self.ua_generator.random
        except Exception:
            self.user_agent = (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/126.0.0.0 Safari/537.36"
            )

        self.session.headers.update({
            "User-Agent": self.user_agent,
            "Accept-Language": "id-ID,id;q=0.9,en;q=0.5",
            "Accept": "text/html,application/xhtml+xml,application/xml,application/rss+xml;q=0.9,*/*;q=0.5",
        })
        self._lock = threading.Lock()
        self._next_slot: dict[str, float] = {}   # host -> waktu monotonic paling awal request berikutnya
        self._robots: dict[str, RobotFileParser] = {}
        
        log.info("HttpClient aktif. User-Agent: %s", self.user_agent)

    # --- jeda per host antar request ---
    def _wait_for_slot(self, host: str, min_gap: float = 0.0) -> None:
        if self.max_delay <= 0:
            return
        with self._lock:
            now = time.monotonic()
            start = max(now, self._next_slot.get(host, 0.0))
            gap = max(random.uniform(self.min_delay, self.max_delay), min_gap)
            self._next_slot[host] = start + gap
        if start > now:
            time.sleep(start - now)

    def _raw_get(self, url: str, min_gap: float = 0.0) -> Optional[requests.Response]:
        host = urlparse(url).netloc
        for attempt in range(self.retries + 1):
            self._wait_for_slot(host, min_gap)
            try:
                resp = self.session.get(url, timeout=self.timeout)
            except (requests.Timeout, requests.ConnectionError) as e:
                log.warning("koneksi gagal (%s) %s, percobaan %d", type(e).__name__, url, attempt + 1)
                time.sleep(1 + attempt)
                continue
            except requests.RequestException as e:
                log.warning("request error %s: %s", url, e)
                return None
            if resp.status_code == 200:
                return resp
            if resp.status_code in (429, 503):
                ra = resp.headers.get("Retry-After", "")
                wait = min(int(ra), 30) if ra.isdigit() else 2 * (attempt + 1)
                log.warning("HTTP %s dari %s, tunggu %ss", resp.status_code, host, wait)
                time.sleep(wait)
                continue
            log.info("HTTP %s %s (dilewati)", resp.status_code, url)
            return None
        return None

    # --- sitemap helper (ambil link sitemap dari robots.txt jika ada) ---
    def sitemaps_from_robots(self, url: str) -> list[str]:
        p = urlparse(url)
        base = f"{p.scheme}://{p.netloc}"
        with self._lock:
            rp = self._robots.get(base)
        if rp is None:
            rp = RobotFileParser()
            resp = self._raw_get(base + "/robots.txt")
            rp.parse(resp.text.splitlines() if resp is not None else [])
            with self._lock:
                self._robots[base] = rp
        return list(rp.site_maps() or [])

    def allowed(self, url: str) -> bool:
        """Selalu True (bypass batasan bot robots.txt)."""
        return True

    def get(self, url: str) -> Optional[requests.Response]:
        """GET langsung seperti browser biasa tanpa blokir robots.txt."""
        return self._raw_get(url)


# Alias untuk backwards compatibility
PoliteSession = HttpClient
