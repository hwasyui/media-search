# Media Search: Panduan Setup

## Kebutuhan

- **Node.js** v22+
- **Python** 3.10+
- **MySQL** 8+

---

## 1. Salin proyek

Pastikan `node_modules/` tidak ikut disalin.

---

## 2. File lingkungan

Salin `.env.example` menjadi `.env`, lalu isi. File `.env` berisi rahasia dan tidak boleh di-commit.

Yang perlu diisi:

```
# AI (Groq lebih dulu, cadangan otomatis ke Gemini)
GROQ_API_KEY=...
GEMINI_API_KEY=...

# MySQL (schema aplikasi: media-search)
DB_HOST=localhost
DB_PORT=3306
DB_USER=...
DB_PASSWORD=...

# Asisten AI (MCP): user MySQL khusus baca, lihat db/mcp_readonly_user.sql
MCP_DB_USER=...
MCP_DB_PASSWORD=...
```

Pengaturan opsional (nilai bawaan dalam kurung): `PORT` (3000), `GROQ_MODEL`, `GEMINI_MODEL`, `PYTHON` (`python`; isi `python3` bila perlu), `AI_MAX_ITEMS`, `FINANCIAL_TTL_HOURS`. Daftar lengkap ada di `.env.example`.

---

## 3. Pasang dependensi Node

```bash
npm install
```

---

## 4. Pasang dependensi Python

```bash
pip install -r listener/requirements.txt
playwright install chromium
```

> Bila perintah `playwright` tidak ditemukan: `python -m playwright install chromium`

---

## 5. Siapkan database

```bash
npm run db:init
```

Perintah ini membuat schema `media-search` beserta tabel dan view dari `db/schema.sql`, lalu mengisi daftar perusahaan awal dari `data/companies.json`.

Untuk asisten AI, jalankan `db/mcp_readonly_user.sql` sebagai admin MySQL (ganti dulu kata sandinya) agar user `mcp_ro` hanya punya hak baca. Panduan data untuk asisten ada di `db/CHATBOT.md`.

---

## 6. Jalankan aplikasi

```bash
npm start
```

Buka http://localhost:3000 (atau sesuai `PORT`). Pengambilan berita, klasifikasi AI, rating, analisis, dan dossier dijalankan dari halaman **Task Runner**. Cara kerja dan arti istilah ada di halaman **Bantuan** (`/help.html`).

---

## Penyimpanan data

Semua data tersimpan di MySQL (schema `media-search`). Ringkasan lapis data berita ada di `db/CHATBOT.md`.

---

## Pemecahan masalah

| Masalah | Solusi |
|---|---|
| Tidak bisa terhubung ke database | Periksa `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` di `.env`, dan pastikan MySQL berjalan |
| Asisten AI tidak menjawab | Pastikan `MCP_DB_USER` dan `MCP_DB_PASSWORD` terisi dan user `mcp_ro` sudah dibuat |
| `python` tidak ditemukan | Isi `PYTHON=python3` di `.env` |
| Port sudah dipakai | Isi `PORT=3001` di `.env` |
