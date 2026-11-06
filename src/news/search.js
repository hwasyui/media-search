import { ADAPTERS } from './sources/adapters.js';

// Batas sementara: satu request maksimal 1 minggu ke belakang (diterapkan di tiap adapter).
export const PERIOD = 'w';

export const SOURCES = Object.fromEntries(
  Object.entries(ADAPTERS).map(([key, a]) => [key, { label: a.label, disabled: a.disabled || null }]),
);

// Kata tambahan untuk memancing hasil yang berbeda (isu, gosip, dll).
export const MODIFIERS = {
  none: { label: 'Polos', terms: '' },
  isu: { label: 'Isu / kabar', terms: 'isu OR kabar OR terbaru' },
  viral: { label: 'Viral', terms: 'viral OR heboh OR trending' },
  kontroversi: { label: 'Kontroversi', terms: 'kontroversi OR skandal OR dugaan OR korupsi' },
  keluhan: { label: 'Keluhan publik', terms: 'keluhan OR kecewa OR komplain' },
  rumor: { label: 'Rumor', terms: 'katanya OR konon OR rumor OR hoax OR spekulasi OR bocoran OR dikabarkan OR "cek ombak"' },      // perusahaan terbuka (rumor pasar)
  // Untuk mengisi dossier: pemilik & akta, klien & proyek, kredit & fasilitas bank, serta perkara hukum (perusahaan tertutup)
  deed: { label: 'Akta & pemilik', terms: 'notaris OR akta OR AHU OR Kemenkumham OR "pemegang saham" OR "pemilik manfaat" OR UBO OR direksi OR komisaris' },
  klien: { label: 'Klien & proyek', terms: 'tender OR "menang tender" OR proyek OR kontrak OR "kontrak baru" OR bowheer OR "owner proyek" OR kontraktor OR subkontraktor OR konsesi OR klien OR mitra' },
  kredit: { label: 'Kredit & keuangan', terms: 'kredit OR pinjaman OR "fasilitas bank" OR perbankan OR sindikasi OR audit OR "laporan keuangan" OR "financial statement" OR utang' },
  hukum: { label: 'Perkara hukum', terms: 'gugatan OR sengketa OR PKPU OR pailit OR wanprestasi OR amdal OR izin OR dugaan' },      // perusahaan tertutup
};

// anchor (opsional): satu atau beberapa nama perusahaan (salah satunya harus ikut muncul). Dipakai untuk pemangku kepentingan agar hasilnya tentang hubungan mereka dengan
// perusahaan itu, bukan berita umum tentang pemangku kepentingannya (mis. "Otoritas Jasa Keuangan" "BCA", bukan OJK saja).
export function buildQuery(keyword, modifier, anchor = null) {
  const terms = MODIFIERS[modifier]?.terms;
  const names = [].concat(anchor || []).filter(Boolean);
  const base = names.length ? `"${keyword}" (${names.map((n) => `"${n}"`).join(' OR ')})` : `"${keyword}"`;
  return terms ? `${base} (${terms})` : base;
}

export async function runSearch({ keywords, sources, modifiers }, onChunk) {
  const jobs = [];
  for (const keyword of keywords)
    for (const source of sources)
      for (const modifier of modifiers)
        jobs.push({ keyword, source, modifier, q: buildQuery(keyword, modifier) });

  const items = [];
  const errors = [];
  const perSource = {};
  let idx = 0;

  async function worker() {
    while (idx < jobs.length) {
      const job = jobs[idx++];
      try {
        const results = await ADAPTERS[job.source].run(job.q);
        perSource[job.source] = (perSource[job.source] || 0) + results.length;
        const chunk = [];
        for (const r of results) {
          const item = { ...r, keyword: job.keyword, sourceKey: job.source, modifier: job.modifier, query: job.q };
          items.push(item);
          chunk.push(item);
        }
        if (onChunk && chunk.length) onChunk({ source: job.source, query: job.q, items: chunk });
      } catch (e) {
        errors.push({ query: `[${job.source}] ${job.q}`, error: e.message });
        if (onChunk) onChunk({ source: job.source, query: job.q, error: e.message, items: [] });
      }
    }
  }
  await Promise.all(Array.from({ length: 3 }, worker));
  return { items, errors, queries: jobs.length, perSource };
}
