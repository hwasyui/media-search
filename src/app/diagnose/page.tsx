'use client';
import '@/styles/diagnose.css';
import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';

type Row = { name: string; ok: boolean; detail: ReactNode };

// Fitur JavaScript yang dipakai halaman utama
const FEATS: Record<string, () => boolean> = {
  'optional chaining ?.': () => new Function('a', 'return a?.b')({ b: 1 }) === 1,
  'nullish ??': () => new Function('return null ?? 1')() === 1,
  'Array.at()': () => [1, 2].at(-1) === 2,
  'Object.fromEntries': () => Object.fromEntries([['a', 1]]).a === 1,
  'String.replaceAll': () => 'aa'.replaceAll('a', 'b') === 'bb',
  'regex lookbehind': () => new RegExp('(?<=a)b').test('ab'),
  'fetch + AbortController': () => typeof fetch === 'function' && typeof AbortController === 'function',
};

export default function DiagnosePage() {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let alive = true;
    const add = (name: string, ok: boolean, detail: ReactNode) => { if (alive) setRows((r) => [...r, { name, ok, detail }]); };

    document.title = 'Media Search · Diagnosa koneksi';
    add('Alamat yang dibuka', true, location.href);
    add('Browser', true, navigator.userAgent);
    for (const [k, f] of Object.entries(FEATS)) {
      let ok = false, d = '';
      try { ok = f(); } catch (e) { d = (e as Error).message; }
      add('Fitur: ' + k, ok, d || (ok ? '' : 'tidak didukung'));
    }

    (async () => {
      for (const p of ['/api/config', '/api/portfolio', '/api/news?limit=1', '/jobs', '/portal.html']) {
        const t0 = performance.now();
        try {
          const r = await fetch(p, { cache: 'no-store' });
          const txt = await r.text();
          let extra = '';
          if (p.startsWith('/api/')) {
            try { const j = JSON.parse(txt); extra = Array.isArray(j) ? j.length + ' item' : Object.keys(j).slice(0, 4).join(','); } catch { extra = 'BUKAN JSON: ' + txt.slice(0, 80); }
          }
          add('GET ' + p, r.ok, 'HTTP ' + r.status + ' · ' + txt.length + ' byte · ' + Math.round(performance.now() - t0) + ' ms ' + extra);
        } catch (e) { add('GET ' + p, false, (e as Error).name + ': ' + (e as Error).message); }
      }
      add('Selesai', true, new Date().toLocaleString('id-ID'));
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="pg-diagnose">
      <h1>Diagnosa koneksi Media Search</h1>
      <p>Halaman ini memeriksa apakah browser ini bisa mengambil data dari server. Kirim tangkapan layar seluruh halaman ini ke pemilik server.</p>
      <table id="t">
        <tbody>
          <tr><th>Pemeriksaan</th><th>Hasil</th></tr>
          {rows.map((r, i) => (
            <tr key={i}><td>{r.name}</td><td><span className={r.ok ? 'ok' : 'bad'}>{r.ok ? 'OK' : 'GAGAL'}</span> <span className="mono">{r.detail}</span></td></tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: 14 }}><Link href="/">Buka portal</Link></p>
    </div>
  );
}
