import { closeMcp, mcpTools } from '@/ai/mcp.js';
import { flushJobs, recoverJobs } from '@/jobs/jobs.js';

const g = globalThis as unknown as { __msBooted?: boolean };

if (!g.__msBooted) {
  g.__msBooted = true;

  recoverJobs().catch((e: Error) => console.error('[jobs] recover gagal:', e.message));

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
