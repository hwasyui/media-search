import { credibilityOf } from './credibility.js';

const PLATFORM_BY_HOST = [
  [/(^|\.)(x|twitter)\.com$/, 'X'],
  [/reddit\.com$/, 'Reddit'],
  [/facebook\.com$/, 'Facebook'],
  [/instagram\.com$/, 'Instagram'],
  [/tiktok\.com$/, 'TikTok'],
  [/youtube\.com$|youtu\.be$/, 'YouTube'],
  [/threads\.net$/, 'Threads'],
  [/linkedin\.com$/, 'LinkedIn'],
  [/kaskus\.co\.id$/, 'Kaskus'],
];

const SPAM = /(slot gacor|judi online|togel|situs slot|link alternatif|pinjol|jual followers|daftar sekarang|bonus new member)/i;

function canonicalUrl(u) {
  try {
    const url = new URL(u);
    url.hash = '';
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|igshid|s$|t$)/i.test(k)) url.searchParams.delete(k);
    url.hostname = url.hostname.replace(/^(www|m|mobile)\./, '').replace(/^twitter\.com$/, 'x.com');
    return url.toString().replace(/\/$/, '');
  } catch {
    return u;
  }
}

function platformOf(u) {
  try {
    const host = new URL(u).hostname.replace(/^www\./, '');
    for (const [re, name] of PLATFORM_BY_HOST) if (re.test(host)) return name;
    return host;
  } catch {
    return 'Web';
  }
}

function cleanText(s = '') {
  return s
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}️]/gu, ' ')
    .replace(/\s*(\.{3}|…)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s) {
  return new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2));
}

function jaccard(a, b) {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

function normalizeDate(d) {
  if (!d) return null;
  const rel = String(d).match(/(\d+)\s*(menit|minute|hari|day|jam|hour|minggu|week)/i);
  if (rel) {
    const n = +rel[1];
    const unit = rel[2].toLowerCase();
    const ms = /menit|minute/.test(unit) ? 6e4 : /hari|day/.test(unit) ? 864e5 : /jam|hour/.test(unit) ? 36e5 : 6048e5;
    return new Date(Date.now() - n * ms).toISOString();
  }
  const t = Date.parse(d);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// Jejak penemuan: sumber (adapter), modifier, dan query yang membuat berita ini muncul (maks. 10, tanpa duplikat).
function addVia(item, r) {
  if (!r.sourceKey && !r.query) return;
  const v = { src: r.sourceKey || null, modifier: r.modifier || null, q: r.query || null, keyword: r.keyword || null };
  if (item.via.length < 10 && !item.via.some((x) => x.src === v.src && x.q === v.q)) item.via.push(v);
}

const credScore = (it) => credibilityOf(it.sourceUrl || it.url).score ?? 0;
const hostOf = (u) => { try { const h = new URL(u).hostname.replace(/^www[.]/, ''); return /(^|[.])google[.]com$/.test(h) ? null : h; } catch { return null; } };
const ALSO_SEEN_MAX = 30;
// Catatan untuk berita yang dibuang karena judulnya sama/mirip: media apa, judul versi mereka, golongan dan skor sumber. Ikut ke tahap simpan (tabel news_also).
// Domain dibaca dari sumber RSS (tautan hasil pencarian umumnya masih tautan Google News, jadi belum alamat penerbit).
function alsoOf(it) {
  const c = credibilityOf(it.sourceUrl || it.url);
  return { domain: hostOf(it.sourceUrl) || hostOf(it.url), url: it.url, title: it.title, tier: c.key || null, score: c.score ?? null, at: new Date().toISOString().slice(0, 19).replace('T', ' ') };
}

export function cleanItems(raw) {
  const stats = { input: raw.length, invalid: 0, spam: 0, duplicate: 0 };
  const byUrl = new Map();
  const kept = [];

  for (const r of raw) {
    const url = canonicalUrl(r.url || '');
    const title = cleanText(r.title);
    const snippet = cleanText(r.snippet);
    const text = [title, snippet].filter(Boolean).join(' — ');
    if (!url || text.length < 25) { stats.invalid++; continue; }
    if (/^balasan mode ai/i.test(title) || /^ai overview/i.test(title) || /balasan mode ai/i.test(snippet)) {
      stats.invalid++;
      continue;
    }
    if (SPAM.test(text)) { stats.spam++; continue; }

    if (byUrl.has(url)) {
      const prev = byUrl.get(url);
      if (!prev.matchedKeywords.includes(r.keyword)) prev.matchedKeywords.push(r.keyword);
      addVia(prev, r);
      stats.duplicate++;
      continue;
    }
    const tk = tokens(text);
    const near = kept.find((k) => jaccard(tk, k._tokens) > 0.8);
    const item = {
      id: kept.length + 1,
      platform: r.sourceName || platformOf(url),
      url,
      title,
      text,
      date: normalizeDate(r.date),
      matchedKeywords: [r.keyword],
      sourceUrl: r.sourceUrl, image: r.image,
      originalUrl: r.originalUrl || undefined,                       // tautan awal dari hasil pencarian (mis. tautan Google News)
      canonical: canonicalUrl(r.originalUrl || r.url),                // dasar hash duplikat: SELALU alamat awal, bukan alamat penerbit hasil resolve
      via: [],
      alsoSeen: [],                                                   // media lain yang memuat berita yang sama (duplikat yang dibuang di tahap ini)
      _tokens: tk,
    };
    if (near) {
      stats.duplicate++;
      // Judul sama/mirip dari penerbit LEBIH KREDIBEL menggantikan yang sudah ada (domain dibaca dari sumber RSS atau tautannya); selain itu yang pertama dipertahankan.
      if (credScore(item) > credScore(near)) {
        item.id = near.id;
        item.alsoSeen = [...near.alsoSeen, alsoOf(near)].slice(0, ALSO_SEEN_MAX);
        item.matchedKeywords = [...new Set([...near.matchedKeywords, r.keyword])];
        item.via = near.via;
        addVia(item, r);
        kept[kept.indexOf(near)] = item;
        for (const [k, v] of byUrl) if (v === near) byUrl.delete(k);
        byUrl.set(url, item);
      } else {
        if (!near.matchedKeywords.includes(r.keyword)) near.matchedKeywords.push(r.keyword);
        addVia(near, r);
        if (near.alsoSeen.length < ALSO_SEEN_MAX && !near.alsoSeen.some((e) => e.url === item.url)) near.alsoSeen.push(alsoOf(item));
      }
      continue;
    }
    addVia(item, r);
    byUrl.set(url, item);
    kept.push(item);
  }
  kept.forEach((k) => delete k._tokens);
  return { items: kept, stats: { ...stats, output: kept.length } };
}
