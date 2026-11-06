// Perbaikan sekali jalan: berita lama yang alamatnya tersimpan sebagai pencarian Google (https://www.google.com/search?q=...) karena
// penyelesai tautan dulu memakai pencarian sebagai tautan pengganti. Skrip ini mencari alamat asli di situs penerbit lewat
//   1. Bing News (judul + domain penerbit, resolver.js), lalu
//   2. Google News RSS (cari ulang judulnya, dapatkan tautan Google-nya, dekode lewat antrean bertahap gnews.js yang aman dari 429),
// lalu menyimpannya ke article_url (+ source_domain). found_url dan url_hash TIDAK diubah (itu alamat saat ditemukan, dasar pencegah duplikat).
// Yang tidak ketemu tidak diubah dan dilaporkan; menghapusnya adalah keputusan Anda.
//   node --env-file=.env scripts/links/fix-search-links.js            (semua)       node --env-file=.env scripts/links/fix-search-links.js 50   (uji 50 baris)
import { db } from '../../src/db/db.js';
import { cleanNewsTitle, resolveArticleUrl } from '../../src/links/resolver.js';
import { isGoogleArticle, resolveGoogleUrl } from '../../src/links/gnews.js';

const limit = Number(process.argv[2]) || 100000;
const [rows] = await db().query(
  "SELECT id, title, source_domain, source_name FROM news_items WHERE (found_url LIKE 'https://www.google.com/search%' OR found_url LIKE 'https://google.com/search%') AND (article_url IS NULL OR article_url LIKE '%google.com/search%') ORDER BY id DESC LIMIT ?",
  [limit],
);
console.log(rows.length + ' berita beralamat pencarian Google dan belum punya alamat penerbit');

const BS = String.fromCharCode(92);
const norm = (t) => cleanNewsTitle(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ITEM_RE = new RegExp('<item>([' + BS + 's' + BS + 'S]*?)</item>', 'g');
const field = (tag, xml) => (new RegExp('<' + tag + '>([' + BS + 's' + BS + 'S]*?)</' + tag + '>').exec(xml) || [])[1] || '';

// Cadangan: cari ulang judulnya di Google News RSS untuk mendapat tautan Google aslinya
async function viaGoogleRss(title, domain) {
  const q = cleanNewsTitle(title);
  const res = await fetch('https://news.google.com/rss/search?q=' + encodeURIComponent('"' + q + '"') + '&hl=id&gl=ID&ceid=ID:id', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36' }, signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const xml = await res.text();
  const site = String(domain || '').replace(/^www[.]/, '');
  for (const m of xml.matchAll(ITEM_RE)) {
    const t = field('title', m[1]).replace(/&amp;/g, '&');
    const link = field('link', m[1]).trim();
    const src = (/<source[^>]*url="([^"]+)"/.exec(m[1]) || [])[1] || '';
    if (link && isGoogleArticle(link) && norm(t) === norm(title) && (!site || src.includes(site))) return link;
  }
  return null;
}

let ok = 0, fail = 0, i = 0;
const worker = async () => {
  while (i < rows.length) {
    const r = rows[i++];
    let real = null;
    try { real = await resolveArticleUrl({ url: '', title: r.title, source_domain: r.source_domain, source_name: r.source_name }); } catch { /* dianggap gagal */ }
    if (!real) {
      try {
        const masked = await viaGoogleRss(r.title, r.source_domain);
        const d = masked ? await resolveGoogleUrl(masked) : null;
        if (d?.ok) real = d.url;
      } catch { /* dianggap gagal */ }
    }
    if (real && /^https?:/.test(real) && !/^https?:[/][/](www[.])?(google|bing)[.]com[/]/i.test(real)) {
      let domain = null;
      try { domain = new URL(real).hostname.replace(/^www[.]/, ''); } catch { /* biarkan */ }
      await db().query('UPDATE news_items SET article_url = ?, source_domain = COALESCE(?, source_domain), link_error = NULL, content_checked = 0 WHERE id = ?', [real, domain, r.id]);
      ok++;
    } else fail++;
    if ((ok + fail) % 25 === 0) console.log(`${ok + fail}/${rows.length}: ${ok} diperbaiki, ${fail} belum ketemu`);
  }
};
await Promise.all(Array.from({ length: 4 }, worker));
console.log(`SELESAI: ${ok} diperbaiki, ${fail} tidak ketemu alamat penerbitnya (tidak diubah). Jalankan "Lengkapi data tersimpan" di Task Runner untuk mengambil isi artikel yang baru ketemu alamatnya.`);
process.exit(0);
