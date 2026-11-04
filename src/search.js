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
  rumor: { label: 'Rumor', terms: 'katanya OR konon OR rumor OR hoax' },
};

export function buildQuery(keyword, modifier) {
  const terms = MODIFIERS[modifier]?.terms;
  return terms ? `"${keyword}" (${terms})` : `"${keyword}"`;
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
