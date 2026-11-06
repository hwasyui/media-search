// State proses yang dulu hidup di server.js. Disimpan di globalThis supaya satu salinan dipakai semua route handler
// (dan selamat dari hot-reload saat development).
import { getFinancials } from '@/risk/financial.js';
import { saveFinancial } from '@/db/save.js';

type CrawlState = { running: boolean; startedAt: number | null; exitCode: number | null; log: string[] };
type MS = { crawl: CrawlState; finBg: Map<string, number>; chatHits: Map<string, number[]>; analyzing: Set<string>; extractingDossier: Set<string> };
const g = globalThis as unknown as { __ms?: MS };

export const state: MS = (g.__ms ??= {
  crawl: { running: false, startedAt: null, exitCode: null, log: [] },
  finBg: new Map(),            // company.id -> waktu percobaan terakhir pembaruan latar belakang
  chatHits: new Map(),         // ip -> waktu pertanyaan asisten (pembatasan laju)
  analyzing: new Set(),
  extractingDossier: new Set(),
});

export const FIN_TTL_MS = (Number(process.env.FINANCIAL_TTL_HOURS) || 24) * 3600 * 1000;

export function backgroundFinancialRefresh(company: { id: string; ticker: string }) {
  const last = state.finBg.get(company.id) || 0;
  if (Date.now() - last < 15 * 60 * 1000) return;
  state.finBg.set(company.id, Date.now());
  getFinancials(company.ticker, { force: true })
    .then((d: any) => (d.errors?.price || d.errors?.valuation ? null : saveFinancial(company.id, d, { force: true })))
    .catch((e: Error) => console.error('[financial] pembaruan latar belakang gagal:', e.message));
}

/** Lapis data yang ditampilkan: 'cleaned' | true (mentah) | false (relevan, bawaan). raw=1 tetap berarti mentah. */
export const layerOf = (q: Record<string, string | undefined>): any => (q.layer === 'cleaned' ? 'cleaned' : q.layer === 'mentah' || q.raw === '1');
