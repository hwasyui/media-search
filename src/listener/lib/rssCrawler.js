// Jalur A: baca RSS/Atom feed (RSS 0.9x/2.0, RDF/RSS 1.0, Atom).
import { XMLParser } from 'fast-xml-parser';
import { candidate, parseDate } from './models.js';
import { decodeBytes, logger as log, plainText } from './util.js';

const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text',
  parseTagValue: false, parseAttributeValue: false, trimValues: true, processEntities: true,
});

const arr = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const str = (v) => {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return Array.isArray(v) ? str(v[0]) : str(v['#text']);
  return String(v);
};

// Tanggal feed: tanpa zona dianggap UTC (seperti feedparser). null bila tak terbaca.
function feedDate(s) {
  s = str(s).trim();
  if (!s) return null;
  const hasTz = /(Z|[+-]\d{2}:?\d{2}|\b(GMT|UTC|UT|[ECMP][SD]T)\b)\s*$/i.test(s);
  let t;
  if (hasTz) t = Date.parse(s);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) t = Date.parse(s);                          // tanggal saja = UTC
  else if (/^\d{4}-\d{2}-\d{2}[ T]/.test(s)) t = Date.parse(`${s.replace(' ', 'T')}Z`);
  else t = Date.parse(`${s} GMT`);
  return Number.isNaN(t) ? null : new Date(t);
}

// Link entri: RSS <link>teks</link>, Atom <link href rel>. Cadangan: <guid> yang berupa URL.
function entryLink(e) {
  const links = arr(e.link);
  let href = '';
  for (const l of links) {
    if (typeof l === 'object') {
      const rel = l['@_rel'];
      if (l['@_href'] && (!rel || rel === 'alternate')) { href = l['@_href']; break; }
      if (!href && l['@_href'] && !rel) href = l['@_href'];
    } else if (str(l).trim()) { href = str(l).trim(); break; }
  }
  if (!href) {
    const first = links.find((l) => typeof l === 'object' && l['@_href']);
    if (first) href = first['@_href'];
  }
  if (!href) {
    const g = arr(e.guid)[0];
    const gv = str(g).trim();
    const perma = typeof g === 'object' ? g['@_isPermaLink'] : undefined;
    if (gv && String(perma).toLowerCase() !== 'false' && /^https?:\/\//i.test(gv)) href = gv;
  }
  return href.trim();
}

function parseFeed(buf) {
  let doc;
  try {
    doc = parser.parse(decodeBytes(buf));
  } catch {
    return { bozo: true, entries: [] };
  }
  let items = [];
  if (doc.rss) items = arr(arr(doc.rss)[0]?.channel).flatMap((c) => arr(c?.item));
  else if (doc['rdf:RDF']) items = arr(doc['rdf:RDF'].item);
  else if (doc.feed) items = arr(doc.feed.entry);
  else return { bozo: true, entries: [] };
  return { bozo: false, entries: items.filter((x) => x && typeof x === 'object') };
}

/** Download feed lewat session sopan lalu parse. [] bila gagal. */
export async function fetchRss(session, feedUrl) {
  const resp = await session.get(feedUrl);
  if (resp === null) return [];
  let feed;
  try {
    feed = parseFeed(resp.content);
  } catch (e) {   // jangan sampai satu feed rusak menghentikan semuanya
    log.warning('feed rusak %s: %s', feedUrl, e.message);
    return [];
  }
  if (feed.bozo && !feed.entries.length) {
    log.info('bukan feed valid: %s', feedUrl);
    return [];
  }

  const out = [];
  for (const e of feed.entries) {
    const url = entryLink(e);
    if (!url) continue;
    const pubRaw = e.pubDate ?? e.published ?? e.issued ?? e.created;
    const updRaw = e.updated ?? e.modified ?? e['dc:date'];
    const published = feedDate(pubRaw) || feedDate(updRaw) || parseDate(str(pubRaw) || str(updRaw));
    const summaryRaw = str(e.description) || str(e.summary) || str(e['content:encoded']) || str(arr(e.content)[0]);
    const author = str(e.author?.name ?? e.author) || str(e['dc:creator']);
    out.push(candidate({
      url,
      title: plainText(str(e.title)),
      published,
      summary: plainText(summaryRaw),
      author: author || '',
      tags: arr(e.category).map((t) => (typeof t === 'object' ? (t['@_term'] || str(t)) : str(t))).filter(Boolean),
    }));
  }
  return out;
}
