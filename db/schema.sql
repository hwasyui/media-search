-- Schema media-search (terpisah dari database CRM). Idempotent: CREATE ... IF NOT EXISTS.
-- Semua waktu disimpan UTC (koneksi memakai time_zone '+00:00').
-- Kunci perusahaan memakai ascii_bin 1 byte/karakter supaya FK dan index di tabel anak kecil dan cepat.
CREATE DATABASE IF NOT EXISTS `media-search` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `media-search`;

CREATE TABLE IF NOT EXISTS companies (
  id            VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name          VARCHAR(255) NOT NULL,
  type          ENUM('public','private') NOT NULL DEFAULT 'private',
  ticker        VARCHAR(10) CHARACTER SET ascii NULL,
  sector        VARCHAR(100) NULL,
  aliases       JSON NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_crawl_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_company_ticker (ticker),
  KEY ix_company_type (type)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stakeholders (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name        VARCHAR(191) NOT NULL,
  role        VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_stakeholder (company_id, name),
  CONSTRAINT fk_stk_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- Berita/sinyal hasil crawl + klasifikasi. Dedup per perusahaan lewat SHA-1 URL kanonik (20 byte).
CREATE TABLE IF NOT EXISTS news_items (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  url_hash         BINARY(20) NOT NULL,
  url              VARCHAR(2048) NOT NULL,
  title            VARCHAR(1000) NOT NULL,
  snippet          TEXT NULL,
  source_name      VARCHAR(255) NULL,
  source_key       VARCHAR(40) CHARACTER SET ascii NULL,
  keyword          VARCHAR(255) NULL,
  modifier         VARCHAR(40) CHARACTER SET ascii NULL,
  published_at     DATETIME NULL,
  fetched_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sort_at          DATETIME AS (COALESCE(published_at, fetched_at)) STORED,
  credibility_tier ENUM('official','mainstream','social_forum') NULL,
  credibility_score TINYINT UNSIGNED NULL,
  impact           ENUM('baik','buruk','netral') NULL,
  impact_reason    VARCHAR(500) NULL,
  status_line      VARCHAR(500) NULL,
  ai_status        ENUM('ok','failed','skipped') NOT NULL DEFAULT 'skipped',
  ai_error         VARCHAR(500) NULL,
  relevant         TINYINT(1) NULL,
  category         VARCHAR(60) CHARACTER SET ascii NULL,
  sentiment        VARCHAR(20) CHARACTER SET ascii NULL,
  confidence       TINYINT UNSIGNED NULL,
  reason           TEXT NULL,
  risk_signals     JSON NULL,
  topic            VARCHAR(255) NULL,
  related          TINYINT(1) NOT NULL DEFAULT 1,
  related_via      VARCHAR(120) NULL,
  title_hash       BINARY(20) NULL,
  platform         VARCHAR(10) CHARACTER SET ascii NOT NULL DEFAULT 'berita',
  content_kind     VARCHAR(16) CHARACTER SET ascii NOT NULL DEFAULT 'berita',
  found_via        JSON NULL,
  last_seen_at     DATETIME NULL,
  seen_count       INT UNSIGNED NOT NULL DEFAULT 1,
  risk_tags        JSON NULL,
  risk_level       TINYINT UNSIGNED NOT NULL DEFAULT 0,
  image_url        VARCHAR(1024) NULL,
  image_checked    TINYINT(1) NOT NULL DEFAULT 0,
  content_html     MEDIUMTEXT NULL,
  content_checked  TINYINT(1) NOT NULL DEFAULT 0,
  article_url      VARCHAR(2048) NULL,
  link_error       VARCHAR(40) CHARACTER SET ascii NULL,
  ai_summary       TEXT NULL,
  company_role     VARCHAR(16) CHARACTER SET ascii NULL,
  source_domain    VARCHAR(255) CHARACTER SET ascii NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_company_url (company_id, url_hash),
  KEY ix_company_sort (company_id, sort_at),
  KEY ix_sort (sort_at),
  KEY ix_relevant_sort (relevant, sort_at),
  KEY ix_tier_sort (credibility_tier, sort_at),
  KEY ix_impact_sort (impact, sort_at),
  KEY ix_category_sort (category, sort_at),
  KEY ix_aistatus (ai_status),
  KEY ix_platform_sort (platform, sort_at),
  KEY ix_kind_sort (content_kind, sort_at),
  KEY ix_company_title (company_id, title_hash),
  KEY ix_company_related (company_id, related, sort_at),
  KEY ix_company_risk (company_id, risk_level, sort_at),
  FULLTEXT KEY ft_search (title, snippet),
  CONSTRAINT fk_news_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

-- Snapshot data keuangan perusahaan terbuka (JSON apa adanya dari src/financial.js).
CREATE TABLE IF NOT EXISTS financial_snapshots (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id    VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ticker        VARCHAR(10) CHARACTER SET ascii NOT NULL,
  fetched_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  price         DECIMAL(20,4) NULL,
  change_5d_pct DECIMAL(8,2) NULL,
  change_1m_pct DECIMAL(8,2) NULL,
  data          JSON NOT NULL,
  PRIMARY KEY (id),
  KEY ix_fin_company_time (company_id, fetched_at),
  CONSTRAINT fk_fin_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- Riwayat crawl/simulasi beserta laporannya.
CREATE TABLE IF NOT EXISTS crawl_runs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  type          ENUM('simulate','cron','manual','portfolio','images','analysis','reclassify','rescore') NOT NULL,
  company_id    VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  started_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at   DATETIME NULL,
  status        ENUM('running','done','error','cancelled') NOT NULL DEFAULT 'running',
  items_fetched INT UNSIGNED NOT NULL DEFAULT 0,
  items_new     INT UNSIGNED NOT NULL DEFAULT 0,
  report        JSON NULL,
  PRIMARY KEY (id),
  KEY ix_runs_company_time (company_id, started_at),
  KEY ix_runs_status (status, started_at),
  CONSTRAINT fk_run_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- Index lokal crawler Python (listener/): arsip artikel mentah, URL yang sudah diproses, hasil auto-discovery.
CREATE TABLE IF NOT EXISTS crawler_articles (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  url_hash     BINARY(20) NOT NULL,
  url          VARCHAR(2048) NOT NULL,
  title        VARCHAR(1000) NOT NULL,
  published_at DATETIME NULL,
  author       VARCHAR(255) NULL,
  domain       VARCHAR(255) CHARACTER SET ascii NULL,
  category     VARCHAR(40) CHARACTER SET ascii NULL,
  source       VARCHAR(255) NULL,
  snippet      TEXT NULL,
  matched      JSON NULL,
  fetched_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sort_at      DATETIME AS (COALESCE(published_at, fetched_at)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_crawler_url (url_hash),
  KEY ix_crawler_sort (sort_at),
  KEY ix_crawler_cat_sort (category, sort_at),
  KEY ix_crawler_domain (domain),
  FULLTEXT KEY ft_crawler (title, snippet)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS crawler_seen (
  url_hash BINARY(20) NOT NULL,
  seen_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (url_hash),
  KEY ix_seen_at (seen_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS crawler_discovery (
  domain     VARCHAR(255) CHARACTER SET ascii NOT NULL,
  home       VARCHAR(512) NULL,
  rss        JSON NOT NULL,
  sitemaps   JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (domain)
) ENGINE=InnoDB;

-- Analisis AI per perusahaan (riwayat; yang terbaru dipakai di halaman perusahaan).
CREATE TABLE IF NOT EXISTS company_analyses (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  model        VARCHAR(80) CHARACTER SET ascii NULL,
  news_count   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  rating_risiko VARCHAR(20) CHARACTER SET ascii NULL,
  kondisi      VARCHAR(20) CHARACTER SET ascii NULL,
  headline     VARCHAR(255) NULL,
  content      JSON NOT NULL,
  PRIMARY KEY (id),
  KEY ix_analysis_company_time (company_id, generated_at),
  CONSTRAINT fk_analysis_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- Dossier terstruktur per perusahaan (Pemilik manfaat, Klien/proyek, Akta/korporasi, Fasilitas bank) dengan status verifikasi & kutipan sumber.
CREATE TABLE IF NOT EXISTS company_dossiers (
  company_id   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  content      JSON NOT NULL,
  PRIMARY KEY (company_id),
  CONSTRAINT fk_dossier_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- Job Task Runner yang tahan restart: status, progres, checkpoint (perusahaan yang sudah selesai), dan log terakhir.
CREATE TABLE IF NOT EXISTS job_runs (
  id           CHAR(8) CHARACTER SET ascii NOT NULL,
  type         VARCHAR(20) CHARACTER SET ascii NOT NULL,
  status       ENUM('running','waiting','done','error','cancelled','interrupted') NOT NULL,
  options      JSON NULL,
  progress     JSON NULL,
  checkpoint   JSON NULL,
  logs         JSON NULL,
  error        VARCHAR(500) NULL,
  resumed_from CHAR(8) CHARACTER SET ascii NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  finished_at  DATETIME NULL,
  PRIMARY KEY (id),
  KEY ix_jobrun_created (created_at),
  KEY ix_jobrun_status (status)
) ENGINE=InnoDB;

-- Snapshot profil risiko pembiayaan (hasil aturan, tanpa AI) per perusahaan: riwayat rating untuk tren dan untuk chatbot.
CREATE TABLE IF NOT EXISTS risk_profiles (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  computed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  trigger_src VARCHAR(12) CHARACTER SET ascii NOT NULL DEFAULT 'view',
  score       TINYINT UNSIGNED NOT NULL,
  rating      VARCHAR(20) CHARACTER SET ascii NOT NULL,
  categories  JSON NOT NULL,
  factors     JSON NOT NULL,
  checklist   JSON NULL,
  caveats     JSON NULL,
  coverage    JSON NULL,
  PRIMARY KEY (id),
  KEY ix_risk_company_time (company_id, computed_at),
  CONSTRAINT fk_risk_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- DATA CLEANED: hanya berita yang benar-benar terkait perusahaan/pemangku kepentingannya (related = 1) dan tidak dinilai AI
-- sebagai tidak relevan (berita yang hanya menyebut stakeholder wajib dikonfirmasi AI), dan bukan konten tutorial/promo konsumen. VIEW (bukan salinan) supaya selalu sinkron dengan news_items (data mentah). Dipakai website & analisis.
CREATE OR REPLACE VIEW news_cleaned AS
SELECT * FROM news_items
WHERE content_kind <> 'konsumen' AND (
  (ai_status = 'ok' AND relevant = 1)                                      -- sudah dinilai AI: AI yang menentukan relevansi (dari isi artikel), termasuk berita yang hanya menyebut pemangku kepentingan
  OR (ai_status <> 'ok' AND related = 1 AND related_via = 'perusahaan')    -- belum dinilai AI: tampil sementara bila teks (judul+isi) menyebut nama/alias perusahaan; ditandai "belum dinilai AI" di UI
);

-- View untuk chatbot/BI: satu baris per perusahaan dengan rating risiko terbaru, analisis AI terbaru, dan hitungan berita 30 hari (cleaned).
CREATE OR REPLACE VIEW v_company_overview AS
SELECT c.id AS company_id, c.name, c.type, c.ticker, c.sector, c.last_crawl_at,
  rp.score AS risk_score, rp.rating AS risk_rating, rp.computed_at AS risk_computed_at, rp.categories AS risk_categories,
  an.headline AS ai_headline, an.rating_risiko AS ai_risk_rating, an.kondisi AS ai_condition, an.generated_at AS ai_generated_at,
  (SELECT COUNT(*) FROM news_cleaned n WHERE n.company_id = c.id AND n.sort_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY) AS news_30d,
  (SELECT COUNT(*) FROM news_cleaned n WHERE n.company_id = c.id AND n.sort_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY AND n.risk_level >= 3) AS risk_news_30d,
  (SELECT COUNT(*) FROM news_items n WHERE n.company_id = c.id) AS raw_total
FROM companies c
LEFT JOIN risk_profiles rp ON rp.id = (SELECT MAX(id) FROM risk_profiles WHERE company_id = c.id)
LEFT JOIN company_analyses an ON an.id = (SELECT MAX(id) FROM company_analyses WHERE company_id = c.id);

-- Berita datar (cleaned) dengan nama perusahaan dan sinyal yang mudah dibaca.
CREATE OR REPLACE VIEW v_news AS
SELECT n.id, n.company_id, c.name AS company_name, c.ticker, n.title, n.snippet, n.url, n.source_name, n.source_domain, n.sort_at AS published_at,
  n.related_via, n.credibility_tier, n.impact, n.impact_reason, n.category, n.sentiment, n.confidence, n.relevant, n.reason AS ai_reason, n.topic,
  n.risk_level, n.risk_tags, n.ai_status
FROM news_cleaned n JOIN companies c ON c.id = n.company_id;

-- Sama seperti v_news tetapi DATA MENTAH (semua hasil crawl, termasuk yang tidak terkait). Pakai hanya bila perlu menelusuri data asli.
CREATE OR REPLACE VIEW v_news_raw AS
SELECT n.id, n.company_id, c.name AS company_name, c.ticker, n.title, n.snippet, n.url, n.source_name, n.source_domain, n.sort_at AS published_at,
  n.related, n.related_via, n.credibility_tier, n.impact, n.impact_reason, n.category, n.sentiment, n.confidence, n.relevant, n.reason AS ai_reason, n.topic,
  n.risk_level, n.risk_tags, n.ai_status
FROM news_items n JOIN companies c ON c.id = n.company_id;
