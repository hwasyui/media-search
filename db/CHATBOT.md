# Panduan data Media Search untuk chatbot / MCP

Schema MySQL: `media-search` (terpisah dari database CRM). Semua waktu **UTC**. Data dikumpulkan dari informasi publik untuk membantu
proses FAP perusahaan pembiayaan alat berat (risiko debitur dan deed discovery). **Semua hasil di sini indikatif, bukan keputusan kredit.**

## Yang paling berguna (mulai dari sini)

| Objek | Isi |
|---|---|
| `v_company_overview` | 1 baris per perusahaan: rating risiko terbaru (aturan), analisis AI terbaru, hitungan berita 30 hari |
| `v_news` | berita datar **cleaned** + nama perusahaan + sinyal (dampak, sentimen, tag risiko, status AI) |
| `news_cleaned` | VIEW data cleaned: hanya berita yang benar-benar terkait perusahaan/pemangku kepentingannya. **Pakai ini secara default.** |
| `news_items` / `v_news_raw` | data MENTAH: semua hasil crawl (unik per URL; duplikat judul tidak disimpan). Pakai hanya bila perlu menelusuri data asli. |
| `risk_profiles` | riwayat profil risiko (skor, rating, skor per kategori, faktor + bukti, checklist, catatan) |
| `company_analyses` | riwayat analisis AI per perusahaan (kolom ringkas + `content` JSON lengkap) |
| `financial_snapshots` | riwayat data keuangan emiten (harga, valuasi, laporan keuangan) dalam JSON |
| `stakeholders` | pengurus / pemegang saham / pihak terkait per perusahaan (dipakai untuk pencarian berita) |

## Tabel dan arti kolom penting

**companies**: `id`, `name`, `type` (`public` = emiten, `private` = tertutup), `ticker`, `sector`, `aliases` (JSON), `last_crawl_at`.

**Data mentah vs cleaned.** `news_items` menyimpan semua hasil crawl. `news_cleaned` (view) hanya memuat baris `related = 1`: teksnya menyebut nama/alias perusahaan (`related_via = 'perusahaan'`)
atau pemangku kepentingannya (`related_via = 'stakeholder: <nama>'`, regulator dan kompetitor tidak dihitung). Berita yang hanya menyebut stakeholder baru masuk cleaned setelah AI
mengonfirmasi `relevant = 1`; berita yang menyebut perusahaan tetap tampil kecuali AI menilai `relevant = 0`. Hitungan, rating risiko, dan website memakai data cleaned.

**news_items** (`v_news` = versi terbaca, cleaned):
- Identitas: `title`, `snippet`, `url`, `source_name`, `source_domain`, `published_at` (`sort_at`: tanggal terbit, fallback waktu crawl), `image_url`.
- Kredibilitas (aturan): `credibility_tier` = `official` | `mainstream` | `social_forum`; `credibility_score`.
- Dampak (aturan kamus): `impact` = `baik` | `buruk` | `netral`, dengan `impact_reason`.
- Hasil AI: `ai_status` = `ok` | `failed` | `skipped`; `relevant`, `category` (mis. `fakta`, `rumor`), `sentiment`, `confidence` (0-100),
  `reason`, `topic`. **Bila `ai_status` bukan `ok`, kolom AI kosong atau tidak dapat diandalkan.**
- Risiko (aturan): `risk_level` 0-5 (tingkat tertinggi) dan `risk_tags` JSON `[{cat, severity, hit}]`.
  Kategori: `hukum`, `keuangan`, `integritas`, `kepemilikan` (deed), `operasional`, `regulasi`, `reputasi`.
  Berita peringatan penipuan untuk konsumen sudah dikecualikan dari tag integritas/hukum/keuangan.

**risk_profiles**: `score` 0-100, `rating` = `rendah` | `sedang` | `tinggi` | `sangat_tinggi` | `tidak_cukup_data`,
`categories` JSON `{kategori: {label, score, count, topSeverity}}`, `factors` JSON (bukti: judul, url, tingkat, `direct` = judul menyebut nama perusahaan),
`checklist` JSON (langkah verifikasi), `caveats` JSON, `coverage` JSON (jumlah berita, ada/tidaknya data keuangan), `trigger_src` (`crawl`/`view`/`analysis`).

**company_analyses**: `rating_risiko`, `kondisi` (`positif|netral|negatif|campuran`), `headline`; `content` JSON berisi `ringkasan`,
`temuan_deed[]`, `faktor_risiko[]`, `faktor_positif[]`, `verifikasi[]`, `outlook`, `pantau[]`, `keyakinan`, dan `refs[]` (berita rujukan bernomor yang dikutip di kolom `dasar`).

## Cara membaca dengan benar

1. Rating `tidak_cukup_data` berarti **belum ada data**, bukan berarti aman.
2. Perusahaan tertutup tidak punya laporan keuangan publik; ratingnya hanya dari berita.
3. Selalu tampilkan bukti (judul + url) saat menyebut temuan, dan tandai berita `category = 'rumor'` sebagai belum terverifikasi.
4. Berita yang judulnya tidak menyebut nama perusahaan (`factors[].direct = false`) bisa menyangkut pihak lain; sarankan verifikasi.
5. Sebut waktu data (`computed_at`, `generated_at`, `last_crawl_at`). Data bisa usang; crawl dijalankan manual dari Task Runner.
6. Jangan menyimpulkan "setujui/tolak"; arahkan ke checklist verifikasi dan dokumen sumber (akta, AHU, SLIK, SIPP, laporan keuangan audit).

## Contoh query

```sql
-- ringkasan semua debitur, paling berisiko dulu
SELECT name, risk_rating, risk_score, ai_headline, news_30d, risk_news_30d
FROM v_company_overview ORDER BY risk_score DESC;

-- berapa banyak hasil crawl yang dibuang karena tidak terkait
SELECT company_id, raw_total, news_30d FROM v_company_overview;

-- bukti risiko berat untuk satu perusahaan
SELECT published_at, title, url, risk_level, risk_tags, ai_status
FROM v_news WHERE company_id = 'garuda' AND risk_level >= 4 ORDER BY published_at DESC LIMIT 20;

-- temuan deed (kepemilikan/pengurus) 90 hari terakhir
SELECT published_at, title, url FROM v_news
WHERE company_id = 'telkom' AND JSON_SEARCH(risk_tags, 'one', 'kepemilikan', NULL, '$[*].cat') IS NOT NULL
  AND published_at >= UTC_TIMESTAMP() - INTERVAL 90 DAY ORDER BY published_at DESC;

-- tren rating satu perusahaan
SELECT computed_at, score, rating FROM risk_profiles WHERE company_id = 'bca' ORDER BY computed_at;

-- analisis AI terbaru lengkap
SELECT content FROM company_analyses WHERE company_id = 'freeport' ORDER BY id DESC LIMIT 1;
```

Catatan akses: untuk chatbot sebaiknya pakai user MySQL **read-only** yang hanya punya `SELECT` pada schema `media-search`.

## Akses lewat MCP (MySQL)

Konfigurasi ada di `.mcp.json` (server `media-search-db`, paket `@maxlmgc/mysql-mcp` versi dikunci 1.0.9, transport stdio lokal).
1. Jalankan [db/mcp_readonly_user.sql](mcp_readonly_user.sql) sebagai admin untuk membuat user `mcp_ro` (hanya SELECT, hanya objek di `media-search`, tanpa akses ke database lain).
2. Isi variabel lingkungan sebelum membuka Claude Code: `MCP_DB_USER`, `MCP_DB_PASSWORD` (opsional `MCP_DB_HOST`, `MCP_DB_PORT`).
3. Batas keamanan utama adalah hak akses MySQL di atas; flag read-only paket MCP hanya lapisan tambahan (ia memeriksa awalan kata SQL, bukan sistem hak akses).
