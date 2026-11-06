// CLI Media Listener.
//
//   node main.js crawl                          # satu siklus, pakai sources.json + queries.txt
//   node main.js crawl --loop 15                # ulangi tiap 15 menit
//   node main.js crawl -q "korupsi AND BUMN" --category news,blog
//   node main.js search "banjir AND (Jakarta OR Bekasi)" --since 2026-11-01
//   node main.js discover kompasiana.com        # cek RSS/sitemap sebuah domain
//   node main.js stats
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { BooleanQuery, ValueError, parseQueries } from './lib/booleanFilter.js';
import { closeDb } from './lib/db.js';
import { discover } from './lib/discovery.js';
import { PoliteSession } from './lib/httpClient.js';
import { defaultSettings, runCycle } from './lib/pipeline.js';
import { Storage } from './lib/storage.js';
import { logger as log, sleep } from './lib/util.js';

const die = (msg, code = 1) => { process.stderr.write(`${msg}\n`); process.exit(code); };

function num(name, v, int = false) {
  const n = Number(v);
  if (v === undefined || Number.isNaN(n) || (int && !Number.isInteger(n))) die(`main.js: error: argument ${name}: nilai tidak valid: '${v}'`, 2);
  return n;
}

function loadQueries(args) {
  let specs = [...(args.query || [])];
  if (fs.existsSync(args['queries-file']) && !args.query?.length) specs = specs.concat(fs.readFileSync(args['queries-file'], 'utf8').split(/\r?\n/));
  return parseQueries(specs);
}

async function cmdCrawl(args) {
  let sources = JSON.parse(fs.readFileSync(args.sources, 'utf8')).filter((s) => s.enabled ?? true);
  if (args.category) {
    const wanted = new Set(args.category.split(','));
    sources = sources.filter((s) => wanted.has(s.category || 'news'));
  }
  if (args.only) {
    const only = new Set(args.only.split(','));
    sources = sources.filter((s) => only.has(s.name));
  }
  const queries = loadQueries(args);
  if (!queries.size && !args['store-all']) die('Tidak ada query. Isi queries.txt, pakai -q, atau tambahkan --store-all.');

  const storage = await Storage.open(args.db);
  if (args['reset-seen']) await storage.clearSeen();
  const session = new PoliteSession({ minDelay: num('--min-delay', args['min-delay']), maxDelay: num('--max-delay', args['max-delay']) });
  const cfg = {
    ...defaultSettings(), maxAgeDays: num('--max-age-days', args['max-age-days']), maxPerSource: num('--max-per-source', args['max-per-source'], true),
    fast: !!args.fast, storeAll: !!args['store-all'],
  };
  const loop = num('--loop', args.loop, true);
  const workers = num('--workers', args.workers, true);
  log.info('%d sumber, %d query: %s', sources.length, queries.size, [...queries.keys()]);

  for (;;) {
    const started = Date.now();
    const results = await runCycle(sources, queries, storage, session, cfg, workers);
    const saved = results.reduce((a, r) => a + r.saved, 0);
    log.info('Siklus selesai %ds: %d artikel baru tersimpan', Math.round((Date.now() - started) / 1000), saved);
    for (const r of results) {
      const flag = r.error ? `ERROR ${r.error}` : '';
      log.info('  %-18s via %-8s kandidat=%-3d diunduh=%-3d tersimpan=%-3d %s', r.source, r.path, r.candidates, r.fetched, r.saved, flag);
    }
    if (!loop) break;
    log.info('Tidur %d menit...', loop);
    await sleep(loop * 60000);
  }
}

async function cmdSearch(args) {
  const storage = await Storage.open(args.db);
  let since = null;
  if (args.since) {
    since = new Date(/^\d{4}-\d{2}-\d{2}$/.test(args.since) ? `${args.since}T00:00:00Z` : /(Z|[+-]\d{2}:?\d{2})$/i.test(args.since) ? args.since : `${args.since}Z`);
    if (Number.isNaN(since.getTime())) die(`Error: Invalid isoformat string: '${args.since}'`);
    since = since.toISOString();
  } else if (args.days) {
    since = new Date(Date.now() - num('--days', args.days, true) * 86400000).toISOString();
  }
  const rows = await storage.search(args.expression ? new BooleanQuery(args.expression) : null,
    { category: args.category, since, limit: num('--limit', args.limit, true) });
  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  for (const r of rows) console.log(`[${(r.published || '-').slice(0, 16)}] (${r.category}/${r.source}) ${r.title}\n    ${r.url}`);
  console.log(`\n${rows.length} hasil`);
}

async function cmdDiscover(args) {
  const session = new PoliteSession({ minDelay: num('--min-delay', args['min-delay']), maxDelay: num('--max-delay', args['max-delay']) });
  console.log(JSON.stringify(await discover(session, args.domain), null, 2));
}

async function cmdStats(args) {
  console.log(JSON.stringify(await (await Storage.open(args.db)).stats(), null, 2));
}

async function cmdGoogleSearch(args) {
  const { searchGoogle } = await import('./lib/googlePlaywright.js');
  const results = await searchGoogle(args.query, { maxResults: num('--limit', args.limit, true), days: num('--days', args.days, true), socialAll: !args['x-only'], xOnly: !!args['x-only'] });
  console.log(JSON.stringify(results));
}

const COMMANDS = {
  crawl: {
    fn: cmdCrawl,
    options: {
      sources: { type: 'string', default: 'sources.json' }, 'queries-file': { type: 'string', default: 'queries.txt' },
      query: { type: 'string', short: 'q', multiple: true }, category: { type: 'string' }, only: { type: 'string' },
      loop: { type: 'string', default: '0' }, 'max-age-days': { type: 'string', default: '2.0' },
      'max-per-source': { type: 'string', default: '30' }, workers: { type: 'string', default: '4' },
      'min-delay': { type: 'string', default: '2.0' }, 'max-delay': { type: 'string', default: '5.0' },
      fast: { type: 'boolean' }, 'store-all': { type: 'boolean' }, 'reset-seen': { type: 'boolean' },
    },
  },
  search: {
    fn: cmdSearch, positional: 'expression',
    options: { category: { type: 'string' }, since: { type: 'string' }, days: { type: 'string' }, limit: { type: 'string', default: '50' }, json: { type: 'boolean' } },
  },
  discover: {
    fn: cmdDiscover, positional: 'domain', required: true,
    options: { 'min-delay': { type: 'string', default: '2.0' }, 'max-delay': { type: 'string', default: '5.0' } },
  },
  stats: { fn: cmdStats, options: {} },
  'google-search': {
    fn: cmdGoogleSearch, positional: 'query', required: true,
    options: { limit: { type: 'string', default: '30' }, days: { type: 'string', default: '7' }, 'x-only': { type: 'boolean' }, json: { type: 'boolean' } },
  },
};

async function main() {
  // opsi global (sebelum sub-perintah): --db, -v/--verbose
  const argv = process.argv.slice(2);
  const globals = { db: 'data/articles.db' };
  let i = 0;
  for (; i < argv.length && argv[i].startsWith('-'); i++) {
    if (argv[i] === '--db') globals.db = argv[++i];
    else if (argv[i].startsWith('--db=')) globals.db = argv[i].slice(5);
    else if (argv[i] === '-v' || argv[i] === '--verbose') globals.verbose = true;
    else die(`main.js: error: argumen tidak dikenal: ${argv[i]}`, 2);
  }
  const name = argv[i];
  const cmd = COMMANDS[name];
  if (!cmd) die(`main.js: error: sub-perintah harus salah satu dari: ${Object.keys(COMMANDS).join(', ')}`, 2);

  let parsed;
  try {
    parsed = parseArgs({ args: argv.slice(i + 1), options: cmd.options, allowPositionals: !!cmd.positional, strict: true });
  } catch (e) {
    die(`main.js ${name}: error: ${e.message}`, 2);
  }
  if (cmd.required && !parsed.positionals.length) die(`main.js ${name}: error: argumen ${cmd.positional} wajib diisi`, 2);
  const args = { ...globals, ...parsed.values };
  if (cmd.positional) args[cmd.positional] = parsed.positionals[0] ?? '';

  process.on('SIGINT', () => { console.log('\nDihentikan.'); process.exit(130); });
  try {
    await cmd.fn(args);
  } catch (e) {
    if (e instanceof ValueError) die(`Error: ${e.message}`);   // mis. sintaks boolean salah
    throw e;
  } finally {
    await closeDb();
  }
}

main();
