-- User MySQL KHUSUS untuk MCP/chatbot: hanya baca (SELECT), hanya schema `media-search`, hanya objek yang aman.
-- JALANKAN SENDIRI sebagai root/admin (skrip ini tidak dijalankan otomatis oleh aplikasi). Ganti password lebih dulu.
--
-- Prinsip:
--  * Batas keamanan sebenarnya ada di sini (hak akses MySQL), bukan di flag read-only milik paket MCP.
--  * TIDAK ada hak apa pun ke database lain (mis. `crm-liugong`: KTP, NPWP, paspor, dst.). Hak diberikan per objek, bukan `media-search`.*,
--    supaya tabel yang ditambahkan nanti tidak otomatis terbuka.
--  * Tidak diberi: job_runs (opsi & log job), crawl_runs (laporan internal), crawler_* (arsip mentah crawler, tidak dibutuhkan chatbot).

CREATE USER IF NOT EXISTS 'mcp_ro'@'localhost' IDENTIFIED BY 'GANTI_PASSWORD_INI'
  WITH MAX_USER_CONNECTIONS 3;                -- ganti 'localhost' bila MCP berjalan dari host lain

-- Data cleaned & ringkasan (pakai ini secara default)
GRANT SELECT ON `media-search`.`news_relevant`       TO 'mcp_ro'@'localhost';   -- lapis relevan (dipakai alat MCP)
GRANT SELECT ON `media-search`.`news_cleaned`        TO 'mcp_ro'@'localhost';
GRANT SELECT ON `media-search`.`v_company_overview`  TO 'mcp_ro'@'localhost';
GRANT SELECT ON `media-search`.`risk_profiles`       TO 'mcp_ro'@'localhost';
GRANT SELECT ON `media-search`.`company_analyses`    TO 'mcp_ro'@'localhost';
GRANT SELECT ON `media-search`.`financial_snapshots` TO 'mcp_ro'@'localhost';
GRANT SELECT ON `media-search`.`companies`           TO 'mcp_ro'@'localhost';
GRANT SELECT ON `media-search`.`stakeholders`        TO 'mcp_ro'@'localhost';
GRANT SELECT ON `media-search`.`company_dossiers`    TO 'mcp_ro'@'localhost';   -- dossier korporasi 4 bagian (pemilik, klien, akta, fasilitas bank) + rujukan berita
GRANT SELECT ON `media-search`.`news_also`           TO 'mcp_ro'@'localhost';   -- media lain yang memuat berita yang sama (duplikat yang tidak disimpan sebagai berita sendiri)
GRANT SELECT ON `media-search`.`app_help`            TO 'mcp_ro'@'localhost';   -- isi halaman Bantuan (alat bantuan_aplikasi); diisi oleh scripts/db-add-help.js dari public/help.html

-- Data mentah (semua hasil crawl, termasuk yang tidak terkait). Hapus 2 baris ini bila chatbot tidak perlu menelusurinya.
-- Catatan: news_items memuat isi artikel lengkap (content_html), kolom hasil AI (ai_summary, company_role, risk_tags, ...), dan alamat artikel asli (article_url).
GRANT SELECT ON `media-search`.`news_items`          TO 'mcp_ro'@'localhost';

-- Tabel/VIEW baru di masa depan TIDAK otomatis terbuka (sengaja): tambahkan satu baris GRANT SELECT per objek di sini, lalu jalankan ulang skrip ini
-- (aman dijalankan berulang; password user yang sudah ada tidak berubah. Untuk mengganti password: ALTER USER 'mcp_ro'@'localhost' IDENTIFIED BY '...';).

FLUSH PRIVILEGES;

-- Verifikasi (jalankan sebagai root):
--   SHOW GRANTS FOR 'mcp_ro'@'localhost';
-- Verifikasi dari sisi user itu (harus GAGAL untuk yang bukan haknya):
--   mysql -u mcp_ro -p -e "SELECT COUNT(*) FROM `media-search`.news_cleaned"     -- berhasil
--   mysql -u mcp_ro -p -e "SELECT COUNT(*) FROM `media-search`.company_dossiers" -- berhasil
--   mysql -u mcp_ro -p -e "SELECT * FROM `media-search`.job_runs LIMIT 1"        -- ERROR 1142 (ditolak)
--   mysql -u mcp_ro -p -e "SHOW DATABASES"                                       -- hanya melihat media-search & information_schema
--   mysql -u mcp_ro -p -e "DELETE FROM `media-search`.companies"                 -- ERROR 1142 (ditolak)
