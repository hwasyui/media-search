import { spawn } from 'node:child_process';
import { json } from '@/lib/server/http';
import { state } from '@/lib/server/server-state';
import { LISTENER_DIR, NODE } from '@/news/sources/adapters.js';

const pushLog = (chunk: unknown) => {
  const crawl = state.crawl;
  crawl.log.push(...String(chunk).split(/\r?\n/).filter(Boolean));
  crawl.log = crawl.log.slice(-300);
};

export async function POST() {
  const crawl = state.crawl;
  if (crawl.running) return json({ error: 'Crawl sedang berjalan' }, 409);
  Object.assign(crawl, { running: true, startedAt: Date.now(), exitCode: null, log: [] });
  const child = spawn(NODE, ['main.js', 'crawl', '--store-all', '--max-age-days', '7', '--max-per-source', '40'], {
    cwd: LISTENER_DIR,
    env: process.env,
  });
  child.stdout.on('data', pushLog);
  child.stderr.on('data', pushLog);
  child.on('error', (e) => { pushLog(`Gagal start: ${e.message}`); crawl.running = false; });
  child.on('close', (code) => { crawl.running = false; crawl.exitCode = code; });
  return json({ started: true });
}

export async function GET() {
  const crawl = state.crawl;
  return json({ running: crawl.running, startedAt: crawl.startedAt, exitCode: crawl.exitCode, tail: crawl.log.slice(-12) });
}
