'use client';
// Memperbarui berita lewat job Task Runner dan menunggunya selesai (polling). Dipakai tombol "Perbarui berita" (halaman perusahaan, tab Risiko) dan "Perbarui semua".
import { useCallback, useState } from 'react';
import { useApp } from '@/components/providers/AppProvider';

type JobLike = { status: string; error?: string; progress?: Record<string, any>; reports?: { clean?: Record<string, any> }[] };

export const jobSummary = (j: JobLike) => {
  const c = j.reports && j.reports.length ? (j.reports[j.reports.length - 1].clean || {}) : {};
  if (j.status === 'cancelled') return 'Dihentikan.';
  if (j.status === 'error') return 'Gagal: ' + (j.error || 'kesalahan tidak diketahui');
  return 'Selesai: ' + (c.beritaBaru ?? 0) + ' berita baru dari ' + (c.beritaDiproses ?? 0) + ' diproses.';
};

/** Menunggu job Task Runner selesai (polling tiap 2 dtk); onTick dipanggil tiap putaran dengan data job. */
export async function waitJob(api: <T = any>(url: string) => Promise<T>, jobId: string, onTick?: (j: JobLike) => void): Promise<JobLike> {
  for (;;) {
    const j = await api<JobLike>('/api/jobs/' + jobId);
    onTick?.(j);
    if (!['running', 'waiting'].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** Perbarui berita satu perusahaan. `label` berisi tahap yang sedang berjalan (null bila diam). */
export function useCompanyRefresh(id: string, onDone: () => Promise<void> | void) {
  const { api, toast, reloadPortfolio } = useApp();
  const [label, setLabel] = useState<string | null>(null);
  const run = useCallback(async () => {
    setLabel('Memperbarui…');
    try {
      const job = await api('/api/companies/' + encodeURIComponent(id) + '/refresh', { method: 'POST' });
      const j = await waitJob(api, job.id, (x) => { if (x.progress?.stage) setLabel(x.progress.stage + (x.progress.work ? ' ' + x.progress.work : '')); });
      toast(jobSummary(j), j.status === 'done' ? 4500 : 8000);
      await reloadPortfolio();
      await onDone();
    } catch (e) { toast('Gagal memperbarui: ' + (e as Error).message, 8000); }
    finally { setLabel(null); }
  }, [api, id, toast, reloadPortfolio, onDone]);
  return { label, run };
}
