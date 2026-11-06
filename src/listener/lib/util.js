// Helper kecil bersama untuk crawler: log, tidur, JSON gaya Python, teks HTML.
import * as cheerio from 'cheerio';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Log (format sama dengan crawler lama: "2026-11-06 08:01:02,123 [INFO] pesan", ke stderr) ──
const pad = (n, w = 2) => String(n).padStart(w, '0');
function asctime() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())},${pad(d.getMilliseconds(), 3)}`;
}
const emit = (level, fmt, args) => {
  let i = 0;
  const msg = args.length ? fmt.replace(/%(-?\d+)?([sd])/g, (_m, w, t) => {
    let v = args[i++];
    if (Array.isArray(v)) v = pyRepr(v);
    v = t === 'd' ? String(Math.trunc(Number(v))) : String(v);
    if (w) v = Number(w) < 0 ? v.padEnd(-Number(w)) : v.padStart(Number(w));
    return v;
  }) : fmt;
  process.stderr.write(`${asctime()} [${level}] ${msg}\n`);
};
export const logger = {
  info: (fmt, ...a) => emit('INFO', fmt, a),
  warning: (fmt, ...a) => emit('WARNING', fmt, a),
  error: (fmt, ...a) => emit('ERROR', fmt, a),
};

// repr() daftar string ala Python: ['a', 'b']
export function pyRepr(v) {
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(', ')}]`;
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return String(v);
}

// json.dumps gaya Python (pemisah ", " dan ": "); ensureAscii=true seperti bawaan Python.
export function pyJson(v, { ensureAscii = true } = {}) {
  const esc = (s) => {
    const j = JSON.stringify(s);
    return ensureAscii ? j.replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`) : j;
  };
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return esc(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map((x) => pyJson(x, { ensureAscii })).join(', ')}]`;
  return `{${Object.entries(v).map(([k, x]) => `${esc(k)}: ${pyJson(x, { ensureAscii })}`).join(', ')}}`;
}

// ── Teks dari HTML, padanan BeautifulSoup.get_text(" ", strip=True) ──
const SKIP = new Set(['script', 'style', 'template']);
export function textOf(node, { strip = true, sep = ' ' } = {}) {
  const parts = [];
  const walk = (n) => {
    if (n.type === 'text' || n.type === 'cdata') {
      const t = n.type === 'cdata' ? (n.children || []).map((c) => c.data).join('') : n.data;
      parts.push(strip ? t.trim() : t);
    } else if (n.children && !(n.type === 'tag' && SKIP.has(n.name))) {
      n.children.forEach(walk);
    }
  };
  walk(node);
  return (strip ? parts.filter(Boolean) : parts).join(strip ? sep : '');
}

export function plainText(html) {
  if (!String(html || '').includes('<')) return String(html || '').trim();   // sudah teks biasa
  const $ = cheerio.load(html);
  return textOf($.root()[0]);
}

// Decode byte -> teks: BOM, lalu charset header/<meta charset>, lalu UTF-8 (cadangan windows-1252)
export function decodeBytes(buf, headerCharset) {
  if (typeof buf === 'string') return buf;
  const b = Buffer.from(buf);
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.toString('utf8', 3);
  let cs = headerCharset;
  if (!cs) {
    const head = b.toString('latin1', 0, 4096);
    cs = (head.match(/<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i) || head.match(/<\?xml[^>]+encoding\s*=\s*["']([\w-]+)["']/i) || [])[1];
  }
  try {
    return new TextDecoder(cs || 'utf-8', { fatal: !cs }).decode(b);
  } catch {
    try { return new TextDecoder(cs || 'utf-8').decode(b); } catch { return new TextDecoder('windows-1252').decode(b); }
  }
}

export const cpSlice = (s, n) => (s.length <= n ? s : Array.from(s).slice(0, n).join(''));
