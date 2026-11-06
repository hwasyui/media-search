// Keterkaitan berita dengan perusahaan (aturan, tanpa AI): berita dihitung "terkait" bila teksnya menyebut nama/alias perusahaan
// atau salah satu pemangku kepentingannya (pengurus, pemegang saham, afiliasi). Regulator dan kompetitor TIDAK dihitung sebagai
// pemangku kepentingan di sini, karena berita tentang mereka hampir selalu menyangkut perusahaan lain.
// Data mentah tetap disimpan semua; flag ini hanya menentukan apa yang dihitung/ditampilkan secara default.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NOT_STAKEHOLDER = /regulator|kompetitor|competitor|pesaing/i;
const LEGAL = /\b(pt|tbk|persero|cv|ud)\b|[()]/gi;
const GROUP_WORDS = /\b(group|grup|holding|corp|corporation)\b/gi;

const clean = (s) => String(s || '').replace(LEGAL, ' ').replace(/\s+/g, ' ').trim();

export function buildMatcher(company) {
  const raw = [];
  const add = (label, term) => { const t = clean(term); if (t.length >= 3) raw.push({ label, term: t }); };
  add('perusahaan', company.name);
  add('perusahaan', company.ticker);      // kode saham (mis. BBCA) sering dipakai di judul berita pasar modal tanpa nama lengkap
  add('perusahaan', company.ticker);      // kode saham (mis. BBCA) sering dipakai di judul tanpa nama lengkap
  for (const a of company.aliases || []) add('perusahaan', a);
  for (const s of company.stakeholders || []) {
    if (NOT_STAKEHOLDER.test(s.role || '')) continue;
    add('stakeholder: ' + s.name, s.name);
    const short = clean(String(s.name).replace(GROUP_WORDS, ' '));      // "Djarum Group" -> "Djarum"
    if (short !== clean(s.name)) add('stakeholder: ' + s.name, short);
  }
  const seen = new Set();
  const compiled = raw.filter((t) => { const k = t.term.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .map((t) => ({ label: t.label, re: new RegExp('(?<![\\p{L}\\p{N}])' + esc(t.term).replace(/\s+/g, '\\s+') + '(?![\\p{L}\\p{N}])', 'iu') }));
  // Urutan: nama/alias perusahaan dulu, baru stakeholder (supaya "via" menunjukkan kecocokan paling langsung)
  compiled.sort((a, b) => (a.label === 'perusahaan' ? 0 : 1) - (b.label === 'perusahaan' ? 0 : 1));
  return (text) => {
    const t = text || '';
    for (const c of compiled) if (c.re.test(t)) return { related: true, via: c.label };
    return { related: false, via: null };
  };
}

// Normalisasi judul untuk deteksi duplikat: huruf kecil, tanpa tanda baca, tanpa akhiran " - Nama Media".
export function normTitle(title) {
  return String(title || '').toLowerCase().replace(/\s[-–|]\s[^-–|]{2,40}$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
export const titleTokens = (title) => new Set(normTitle(title).split(' ').filter((w) => w.length > 2));
export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
export const NEAR_DUP = 0.8;      // sama dengan ambang di clean.js
