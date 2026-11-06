# Media Search: Panduan Setup

## Kebutuhan

- **Node.js** v22+
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

Pengaturan opsional (nilai bawaan dalam kurung): `PORT` (3000), `GROQ_MODEL`, `GEMINI_MODEL`, `AI_MAX_ITEMS`, `FINANCIAL_TTL_HOURS`. Daftar lengkap ada di `.env.example`.

---

## 3. Pasang dependensi Node

```bash
npm install
```

---

## 4. Pasang browser untuk Playwright

```bash
npx playwright install chromium
```

---

## 5. Siapkan database

```bash
npm run db:init
```

Perintah ini membuat schema `media-search` beserta tabel dan view dari `db/schema.sql`, lalu mengisi daftar perusahaan awal dari `data/companies.json`.

Untuk asisten AI, jalankan `db/mcp_readonly_user.sql` sebagai admin MySQL (ganti dulu kata sandinya) agar user `mcp_ro` hanya punya hak baca. Panduan data untuk asisten ada di `db/CHATBOT.md`.

---

## 6. Jalankan aplikasi

Aplikasi ini Next.js (React + TypeScript) dengan API di folder yang sama. Untuk bekerja dan mengubah kode:

```bash
npm run dev
```

Untuk dipakai sehari-hari, bangun dulu lalu jalankan versi produksi (setiap habis mengubah kode, ulangi `npm run build`):

```bash
npm run build
npm start
```

Buka http://localhost:3000 (atau sesuai `PORT`). Pengambilan berita, klasifikasi AI, rating, analisis, dan dossier dijalankan dari halaman **Task Runner**. Cara kerja dan arti istilah ada di halaman **Bantuan** (`/help`).

---

## Penyimpanan data

Semua data tersimpan di MySQL (schema `media-search`). Ringkasan lapis data berita ada di `db/CHATBOT.md`.

---

## Pemecahan masalah

| Masalah | Solusi |
|---|---|
| Tidak bisa terhubung ke database | Periksa `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` di `.env`, dan pastikan MySQL berjalan |
| Asisten AI tidak menjawab | Pastikan `MCP_DB_USER` dan `MCP_DB_PASSWORD` terisi dan user `mcp_ro` sudah dibuat |
| Port sudah dipakai | Isi `PORT=3001` di `.env` |

---

## Jadwal otomatis (GitHub Actions)

Dua workflow di `.github/workflows/` menjalankan Task Runner secara terjadwal:

| Workflow | Jadwal | Isi |
|---|---|---|
| `daily.yml` | Setiap hari 06.00 WIB | Full pipeline semua perusahaan (berita baru, klasifikasi AI, rating risiko). Analisis AI dan dossier dibuat ulang bila sudah lebih dari 7 hari |
| `weekly.yml` | Setiap Minggu 22.00 WIB | Lengkapi data tersimpan (unmask, isi artikel, klasifikasi AI), lalu buat ulang analisis AI dan dossier |

Keduanya juga bisa dijalankan manual dari tab Actions (Run workflow).

Database dan server Media Search ada di komputer sendiri, jadi workflow berjalan di **runner self-hosted** di komputer yang sama:

1. Di GitHub: Settings → Actions → Runners → New self-hosted runner, lalu ikuti petunjuknya sampai runner terpasang dan berstatus Idle. Disarankan dipasang sebagai layanan agar tetap hidup.
2. Pastikan server berjalan (`npm start` atau pm2) dan komputer tidak sleep pada jam jadwal.
3. Alamat server bawaan workflow adalah `http://localhost:3062`. Bila port berbeda, buat repository variable `MEDIA_SEARCH_URL` di Settings → Secrets and variables → Actions → Variables.

Workflow memanggil API Task Runner, memantau job sampai selesai, dan berstatus gagal bila job berhenti dengan error. Tidak ada rahasia yang disimpan di GitHub.
