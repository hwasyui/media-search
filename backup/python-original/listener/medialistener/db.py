"""Koneksi MySQL untuk crawler. Kredensial dari environment (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD);
bila belum ada (mis. dijalankan langsung dari terminal), dibaca dari ../.env milik aplikasi.
Data ada di schema `media-search` (override: MEDIA_DB_NAME). Buat tabelnya sekali dengan `npm run db:init`."""
from __future__ import annotations

import os
import threading
from pathlib import Path

import pymysql
import pymysql.cursors

_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"
_local = threading.local()


def _load_env_file() -> None:
    if not _ENV_FILE.exists():
        return
    for line in _ENV_FILE.read_text("utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def connect() -> pymysql.connections.Connection:
    """Satu koneksi per thread (pipeline multi-thread); tersambung ulang otomatis bila putus."""
    conn = getattr(_local, "conn", None)
    if conn is not None:
        try:
            conn.ping(reconnect=True)
            return conn
        except Exception:
            _local.conn = None
    if not os.environ.get("DB_HOST"):
        _load_env_file()
    conn = pymysql.connect(
        host=os.environ["DB_HOST"], port=int(os.environ.get("DB_PORT") or 3306),
        user=os.environ["DB_USER"], password=os.environ.get("DB_PASSWORD", ""),
        database=os.environ.get("MEDIA_DB_NAME", "media-search"),
        charset="utf8mb4", autocommit=True, connect_timeout=15,
        cursorclass=pymysql.cursors.DictCursor, init_command="SET time_zone = '+00:00'",
    )
    _local.conn = conn
    return conn
