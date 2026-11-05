// Fungsi BACA dari MySQL (schema media-search). Fungsi simpan ada di save.js.
import { db } from './db.js';

const parseJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

export async function listCompanies() {
  const [cos] = await db().query('SELECT id,name,type,ticker,sector,aliases,extra_queries,last_crawl_at FROM companies ORDER BY name');
  const [stk] = await db().query('SELECT company_id,name,role FROM stakeholders ORDER BY id');
  return cos.map((c) => ({
    id: c.id, name: c.name, type: c.type, ticker: c.ticker || undefined, sector: c.sector,
    aliases: parseJson(c.aliases) || [], extraQueries: parseJson(c.extra_queries) || [], lastCrawlAt: c.last_crawl_at,
    stakeholders: stk.filter((s) => s.company_id === c.id).map((s) => ({ name: s.name, role: s.role })),
  }));
}

export async function getCompany(id) {
  return (await listCompanies()).find((c) => c.id === id) || null;
}

// Ubah pengaturan pencarian perusahaan yang sudah ada (alias dan query tambahan). Pengurus/pemegang saham tidak disentuh.
export async function updateCompanySearch(id, { aliases, extraQueries }) {
  const sets = [], params = [];
  if (Array.isArray(aliases)) { sets.push('aliases = ?'); params.push(JSON.stringify(aliases)); }
  if (Array.isArray(extraQueries)) { sets.push('extra_queries = ?'); params.push(JSON.stringify(extraQueries)); }
  if (!sets.length) return getCompany(id);
  const [r] = await db().query('UPDATE companies SET ' + sets.join(', ') + ' WHERE id = ?', [...params, id]);
  if (!r.affectedRows && !(await getCompany(id))) return null;
  return getCompany(id);
}

export async function saveCompany(c) {
  const id = c.id || (c.ticker ? c.ticker.toLowerCase() : c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  const aliases = Array.isArray(c.aliases) ? JSON.stringify(c.aliases) : JSON.stringify([c.name, ...(c.ticker ? [c.ticker] : [])]);
  await db().query(
    `INSERT INTO companies (id, name, type, ticker, sector, aliases, extra_queries) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name=VALUES(name), type=VALUES(type), ticker=VALUES(ticker), sector=VALUES(sector), aliases=VALUES(aliases), extra_queries=VALUES(extra_queries)`,
    [id, c.name, c.type || 'public', c.ticker || null, c.sector || 'Bursa Efek Indonesia', aliases, JSON.stringify(Array.isArray(c.extraQueries) ? c.extraQueries : [])]
  );
  if (Array.isArray(c.stakeholders)) {
    for (const s of c.stakeholders) {
      if (s.name) {
        await db().query(
          `INSERT INTO stakeholders (company_id, name, role) VALUES (?, ?, ?)`,
          [id, s.name, s.role || '']
        );
      }
    }
  }
  return getCompany(id);
}

export async function latestFinancial(companyId) {
  const [[row]] = await db().query('SELECT data FROM financial_snapshots WHERE company_id = ? ORDER BY fetched_at DESC LIMIT 1', [companyId]);
  return row ? parseJson(row.data) : null;
}

export async function listReports() {
  const [rows] = await db().query('SELECT id,type,UNIX_TIMESTAMP(finished_at) * 1000 AS mtime FROM crawl_runs WHERE report IS NOT NULL ORDER BY id DESC LIMIT 50');
  return rows.map((r) => ({ name: `${r.type}-${r.id}`, mtime: Number(r.mtime) }));
}

export async function readReport(name) {
  const m = /^(?:simulate|cron|manual|portfolio|images|analysis|reclassify)-(\d+)$/.exec(name);
  if (!m) throw Object.assign(new Error('nama laporan tidak valid'), { status: 400 });
  const [[row]] = await db().query('SELECT report FROM crawl_runs WHERE id = ?', [Number(m[1])]);
  if (!row) throw Object.assign(new Error('laporan tidak ditemukan'), { status: 404 });
  return parseJson(row.report);
}

export async function latestAnalysis(companyId) {
  const [[row]] = await db().query('SELECT generated_at, content FROM company_analyses WHERE company_id = ? ORDER BY id DESC LIMIT 1', [companyId]);
  return row ? { generatedAt: row.generated_at, ...parseJson(row.content) } : null;
}

export async function listJobRuns(limit = 10) {
  const [rows] = await db().query('SELECT * FROM job_runs ORDER BY created_at DESC LIMIT ?', [limit]);
  return rows.map((r) => ({
    id: r.id, type: r.type, status: r.status, opts: parseJson(r.options) || {}, progress: parseJson(r.progress) || {},
    checkpoint: parseJson(r.checkpoint) || { done: [], total: 0 }, logs: parseJson(r.logs) || [], error: r.error, resumedFrom: r.resumed_from,
    createdAt: new Date(r.created_at).getTime(), startedAt: new Date(r.created_at).getTime(), finishedAt: r.finished_at ? new Date(r.finished_at).getTime() : null,
  }));
}

// Profil risiko terbaru tiap perusahaan (untuk penanda warna di sidebar).
export async function latestRiskProfiles() {
  const [rows] = await db().query(
    'SELECT rp.company_id, rp.score, rp.rating, rp.computed_at, rp.coverage FROM risk_profiles rp JOIN (SELECT MAX(id) id FROM risk_profiles GROUP BY company_id) m ON m.id = rp.id',
  );
  return Object.fromEntries(rows.map((r) => [r.company_id, { score: r.score, rating: r.rating, computedAt: r.computed_at, coverage: parseJson(r.coverage) }]));
}
