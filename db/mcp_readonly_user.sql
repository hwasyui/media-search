-- User MySQL KHUSUS untuk MCP/chatbot: hanya baca (SELECT), hanya schema `media-search`, hanya objek yang aman.
-- JALANKAN SENDIRI sebagai root/admin (skrip ini tidak dijalankan otomatis oleh aplikasi). Ganti password lebih dulu.
--
-- Prinsip:
--  * Batas keamanan sebenarnya ada di sini (hak akses MySQL), bukan di flag read-only milik paket MCP.
--  * TIDAK ada hak apa pun ke database lain (mis. `crm-liugong`: KTP, NPWP, paspor, dst.). Hak diberikan per objek, bukan `media-search`.*,
--    supaya tabel yang ditambahkan nanti tidak otomatis terbuka.
--  * Tidak diberi: job_runs (opsi & log job), crawl_runs (laporan internal), crawler_* (arsip mentah crawler, tidak dibutuhkan chatbot).

CREATE USER IF NOT EXISTS 'mcp_ro'@'localhost' IDENTIFIED BY 'GANTI_PASSWORD_KUAT_DI_SINI'
  WITH MAX_USER_CONNECTIONS 3;                -- ganti 'localhost' bila MCP berjalan dari host lain

-- Data cleaned & ringkasan (pakai ini secara default)
GRANT SELECT ON `media-search`.`news_cleaned`        TO 'mcp_ro'@'localhost';
GRANT SELECT ON `media-search`.`v_news`              TO 'mcp_ro'@'localhost';
GRANT SELECT ON `media-search`.`v_company_overview`  TO 'mcp_ro'@'localhost';
GRANT SELECT ON `media-search`.`risk_profiles`       TO 'mcp_ro'@'localhost';
GRANT SELECT ON `media-search`.`company_analyses`    TO 'mcp_ro'@'localhost';
GRANT SELECT ON `media-search`.`financial_snapshots` TO 'mcp_ro'@'localhost';
GRANT SELECT ON `media-search`.`companies`           TO 'mcp_ro'@'localhost';
GRANT SELECT ON `media-search`.`stakeholders`        TO 'mcp_ro'@'localhost';

-- Data mentah (semua hasil crawl, termasuk yang tidak terkait). Hapus 2 baris ini bila chatbot tidak perlu menelusurinya.
GRANT SELECT ON `media-search`.`news_items`          TO 'mcp_ro'@'localhost';
GRANT SELECT ON `media-search`.`v_news_raw`          TO 'mcp_ro'@'localhost';

FLUSH PRIVILEGES;

-- Verifikasi (jalankan sebagai root):
--   SHOW GRANTS FOR 'mcp_ro'@'localhost';
-- Verifikasi dari sisi user itu (harus GAGAL untuk yang bukan haknya):
--   mysql -u mcp_ro -p -e "SELECT COUNT(*) FROM `media-search`.news_cleaned"     -- berhasil
--   mysql -u mcp_ro -p -e "SELECT * FROM `media-search`.job_runs LIMIT 1"        -- ERROR 1142 (ditolak)
--   mysql -u mcp_ro -p -e "SHOW DATABASES"                                       -- hanya melihat media-search & information_schema
--   mysql -u mcp_ro -p -e "DELETE FROM `media-search`.companies"                 -- ERROR 1142 (ditolak)
