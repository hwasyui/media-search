import { closeMcp, mcpTools } from '@/ai/mcp.js';
import { flushJobs, recoverJobs } from '@/jobs/jobs.js';
import { cleanCovers } from '@/content/covers-clean.js';

const g = globalThis as unknown as { __msBooted?: boolean };

if (!g.__msBooted) {
  g.__msBooted = true;

  recoverJobs().catch((e: Error) => console.error('[jobs] recover gagal:', e.message));

  // Housekeeping cache gambar sampul (data/covers): semenit setelah server menyala, lalu tiap 24 jam.
  const sweepCovers = () => cleanCovers().then((r: any) => { if (r?.removedOrphans || r?.removedOld) console.log(`[covers] dibersihkan: ${r.removedOrphans} yatim, ${r.removedOld} lama`); }).catch((e: Error) => console.error('[covers] pembersihan gagal:', e.message));
  setTimeout(sweepCovers, 60_000).unref();
  setInterval(sweepCovers, 24 * 3600_000).unref();

  // Asisten AI memakai MCP: sambungkan sekarang (di latar belakang) supaya kesalahan konfigurasi langsung terlihat dan pertanyaan pertama tidak menunggu.
  mcpTools()
    .then((t: any[]) => console.log(`[mcp] tersambung: ${t.length} alat (${t.map((x) => x.name).join(', ')})`))
    .catch((e: Error) => console.warn('[mcp] BELUM tersambung, asisten AI belum bisa menjawab:', e.message));

  // Dimatikan baik-baik (Ctrl+C / restart): simpan checkpoint terakhir dan tandai job aktif "terputus" sebelum keluar.
  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) {
    process.on(sig, async () => {
      if (stopping) return;
      stopping = true;
      try { await closeMcp(); } catch { /* abaikan */ }
      try { const n = await flushJobs(); if (n) console.log(`[jobs] ${n} job aktif ditandai terputus (checkpoint tersimpan)`); } catch (e) { console.error('[jobs] flush gagal:', (e as Error).message); }
      process.exit(0);
    });
  }
}
