'use client';
// Task Runner: jalankan pengambilan data di server (background), pantau log, lanjutkan job yang terputus. Pengganti jobs.html.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import StepsHelp from './StepsHelp';

const ACTIVE = ['running', 'waiting'];
const HIST_PER = 10;
const TITLES: Record<string, string> = { backfill: 'Lengkapi data tersimpan', portfolio: 'Full pipeline', content: 'Unmask + ambil isi & gambar artikel', images: 'Ambil gambar (lama)', dedupe: 'Buang duplikat (lama)', analysis: 'Analisis AI', reclassify: 'Klasifikasi AI ulang', rescore: 'Keterkaitan nama & bersihkan kata kunci', financial: 'Data keuangan', dossier: 'Ekstrak dossier korporasi', cron: 'Cron' };
const PER_COMPANY = ['backfill', 'portfolio', 'content', 'analysis', 'reclassify', 'rescore', 'financial', 'dossier'];
const STAT: Record<string, string> = { running: 'berjalan', waiting: 'menunggu', done: 'selesai', error: 'error', cancelled: 'dihentikan', interrupted: 'terputus' };
const STATE_PREFIX: Record<string, string> = { running: 'BERJALAN', waiting: 'MENUNGGU', done: 'SELESAI', error: 'ERROR', cancelled: 'DIHENTIKAN', interrupted: 'TERPUTUS' };
const SRC_LABEL: Record<string, string> = { google_news: 'Google News (RSS)', bing_news: 'Bing News (RSS)', youtube: 'YouTube (API web)', social_media: 'Media sosial (via Google)' };
const MOD_LABEL: Record<string, string> = { none: 'Polos', isu: 'Isu / kabar', viral: 'Viral', kontroversi: 'Kontroversi', keluhan: 'Keluhan', rumor: 'Rumor', deed: 'Akta & pemilik', klien: 'Klien & proyek', kredit: 'Kredit & keuangan', hukum: 'Perkara hukum' };

// Jalur yang dipakai tiap tombol (harus sama dengan lanesOf di server). Tombol dinonaktifkan hanya bila jalurnya sedang dipakai job lain,
// jadi crawl dan AI bisa berjalan bersamaan. "Full pipeline" tetap bisa dipakai saat AI sibuk: server otomatis menjalankannya tanpa AI.
const LANES: Record<string, string[]> = { goOne: ['crawl'], goAll: ['crawl'], goAllRaw: ['crawl'], goReclass: ['ai'], goContent: ['crawl', 'ai'], goBackfill: ['crawl', 'ai'], goBackfillOne: ['crawl', 'ai'], goFin: ['crawl'], goAnalysis: ['ai'], goRescore: ['db'] };
const BTN_TITLE: Record<string, string> = {
  goAllRaw: 'Hanya mengambil dan menyimpan data mentah; AI bisa dijalankan terpisah dan bersamaan',
  goContent: 'Dua hal sekaligus: (1) unmask tautan Google News ke alamat asli penerbit (disimpan di article_url), (2) satu kali unduh per artikel untuk isi (body HTML) dan gambar pratinjau. Ikut mencoba lagi yang gagal sebelumnya. AI tidak boleh berjalan bersamaan.',
  goReclass: 'AI membaca isi artikel dan menilai berita yang belum dinilai atau formatnya lama.',
  goDossier: 'Dossier korporasi 4 bagian (pemilik & pengendali, klien & proyek, akta, fasilitas bank) dengan kutipan bukti dan nomor berita.',
  goRescore: "Tanpa AI. Menghitung ulang 'menyebut nama perusahaan' dari isi artikel dan mengosongkan tag risiko/dampak hasil kata kunci lama pada berita yang belum dinilai AI.",
};

type Job = { id: string; type: string; status: string; opts?: { companies?: string[]; classify?: boolean }; lanes?: string[]; createdAt: number; startedAt?: number; finishedAt?: number;
  progress?: Record<string, any>; logs?: string[]; checkpoint?: { done: string[]; total: number }; resumable?: boolean; resumedFrom?: string; error?: string; cancelRequested?: boolean;
  reports?: { perWork?: Record<string, any>[] }[]; serverNow?: number };
type Line = { t: string; body: string; cls: string };

const pad = (n: number) => String(n).padStart(2, '0');
const fmtDur = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60); };
const fmtWhen = (ms: number) => new Date(ms).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function parseLine(text: string, cls?: string): Line {
  const m = /^(\d{2}[.:]\d{2}[.:]\d{2})\s+(.*)$/.exec(text);
  const body = m ? m[2] : text;
  const c = cls || (/^──/.test(body) ? 'h' : /gagal|error|ditolak/i.test(body) ? 'e' : /^selesai|dibuat|tersimpan|berhasil/i.test(body) ? 'ok' : /jeda|menunggu|pembatalan|tanpa AI/i.test(body) ? 'w' : '');
  return { t: (m ? m[1] : '--:--:--').replace(/\./g, ':'), body, cls: c };
}

export default function JobsView() {
  const [companies, setCompanies] = useState<{ id: string; ticker?: string; name: string }[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [list, setList] = useState<Job[]>([]);
  const [view, setView] = useState<Job | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [histPage, setHistPage] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [planOpen, setPlanOpen] = useState<Set<number>>(new Set());
  const [cancelling, setCancelling] = useState(false);
  const [, setNow] = useState(0);

  // nilai kontrol alur polling (dibaca di dalam interval, jadi disimpan di ref)
  const ctl = useRef({ jobId: null as string | null, blank: false, shown: 0, busy: false, clockSkew: 0, histPage: 0 });
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const cmap = useRef<Record<string, string>>({});

  const durOf = (j: Job) => ((ACTIVE.includes(j.status) ? Date.now() + ctl.current.clockSkew : (j.finishedAt || j.progress?.beatAt || Date.now() + ctl.current.clockSkew)) - (j.startedAt || j.createdAt));
  function jobLabel(j: Job) {
    const o = j.opts || {}, c = o.companies || [];
    let t = TITLES[j.type] || j.type;
    if (c.length === 1) t += ' · ' + (cmap.current[c[0]] || c[0]);
    else if (c.length > 1) t += ' · ' + c.length + ' perusahaan';
    else if (PER_COMPANY.includes(j.type)) t += ' · semua perusahaan';
    if (j.type === 'portfolio' && o.classify === false) t += ' · tanpa AI';
    return t;
  }

  const addLine = useCallback((text: string, cls?: string) => setLines((p) => [...p, parseLine(text, cls)]), []);

  const applyJob = useCallback((j: Job) => {
    if (j.serverNow) ctl.current.clockSkew = j.serverNow - Date.now();
    setView(j);
    const logs = j.logs || [];
    if (logs.length < ctl.current.shown) ctl.current.shown = logs.length;     // buffer log server terpotong
    const fresh = logs.slice(ctl.current.shown);
    ctl.current.shown = logs.length;
    if (fresh.length) setLines((p) => [...p, ...fresh.map((l) => parseLine(l))]);
  }, []);

  // Satu putaran polling: daftar semua job (untuk jalur & riwayat) + detail job yang dipilih (log).
  const tick = useCallback(async () => {
    const c = ctl.current;
    if (c.busy) return;
    c.busy = true;
    try {
      const l: Job[] = await (await fetch('/api/jobs')).json();
      setList(l);
      if (!c.jobId && !c.blank && l[0]) { c.jobId = l[0].id; setJobId(l[0].id); }
      const pages = Math.max(1, Math.ceil(l.length / HIST_PER));
      if (c.histPage > pages - 1) { c.histPage = pages - 1; setHistPage(c.histPage); }
      if (c.jobId && !c.blank) {
        const r = await fetch('/api/jobs/' + c.jobId);
        if (r.ok) applyJob(await r.json());
      }
    } catch { /* coba lagi pada putaran berikutnya */ }
    c.busy = false;
  }, [applyJob]);

  useEffect(() => {
    (async () => {
      const cfg = await (await fetch('/api/config')).json();
      cmap.current = Object.fromEntries(cfg.companies.map((c: any) => [c.id, c.ticker || c.name]));
      setCompanies(cfg.companies);
      setCompanyId(cfg.companies[0]?.id || '');
      const jobs: Job[] = await (await fetch('/api/jobs')).json();
      const cur = jobs.find((j) => ACTIVE.includes(j.status)) || jobs[0];
      if (cur) { ctl.current.jobId = cur.id; setJobId(cur.id); }
      tick();
    })();
    const t1 = setInterval(tick, 1500);
    const t2 = setInterval(() => setNow(Date.now()), 1000);        // jam durasi berdetak tiap detik, memakai jam server
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [tick]);

  // gulir otomatis ke bawah bila log sedang di dasar
  useLayoutEffect(() => { const el = logRef.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [lines]);

  function select(id: string) {
    const c = ctl.current;
    c.jobId = id; c.blank = false; c.shown = 0;
    setJobId(id); setLines([]); setView(null); setPlanOpen(new Set()); setCancelling(false);
    tick();
  }
  async function start(type: string, options: object) {
    const r = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, options }) });
    const j = await r.json();
    if (!r.ok) { addLine('[ditolak] ' + j.error, 'e'); return; }
    select(j.id);
  }
  async function resume() {
    if (!ctl.current.jobId) return;
    const r = await fetch('/api/jobs/' + ctl.current.jobId + '/resume', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) { addLine('[ditolak] ' + j.error, 'e'); return; }
    select(j.id);
  }
  async function cancel() {
    if (!ctl.current.jobId) return;
    setCancelling(true);
    await fetch('/api/jobs/' + ctl.current.jobId + '/cancel', { method: 'POST' });
  }
  // Bersihkan = mulai dari tampilan kosong: log, kartu status, rencana crawl, dan ringkasan dikosongkan (riwayat job tetap; klik salah satu untuk membukanya lagi)
  function clear() {
    const c = ctl.current;
    c.blank = true; c.jobId = null; c.shown = 0;
    setJobId(null); setView(null); setLines([]); setPlanOpen(new Set()); setCancelling(false);
  }

  const activeJobs = list.filter((j) => ACTIVE.includes(j.status));
  const held = activeJobs.flatMap((j) => j.lanes || []);
  const laneState = (id: string) => {
    const need = LANES[id] || [];
    const busy = activeJobs.length > 0 && (held.includes('db') || need.includes('db') || need.some((l) => held.includes(l)));
    return { disabled: busy, title: busy ? (held.includes('db') || need.includes('db') ? 'Pemeliharaan data harus berjalan sendiri' : 'Jalur ini sedang dipakai job lain') : BTN_TITLE[id] || '' };
  };
  const B = (id: string, extra?: { className?: string }) => ({ id, disabled: laneState(id).disabled, title: laneState(id).title, className: 'btn' + (extra?.className ? ' ' + extra.className : '') });

  // ----- turunan tampilan untuk job yang sedang dilihat -----
  const j = view;
  const active = j ? ACTIVE.includes(j.status) : false;
  const p = j?.progress || {};
  const cp = j?.checkpoint || { done: [], total: 0 };
  const left = cp.total - cp.done.length;
  const label = j ? jobLabel(j).toUpperCase() : '';
  let stateText = 'STANDBY';
  if (j) {
    stateText = j.status === 'error' && /^Sebagian selesai/.test(j.error || '') ? 'SEBAGIAN GAGAL · ' + label : STATE_PREFIX[j.status] ? STATE_PREFIX[j.status] + ' · ' + label : j.status;
    if (active && j.cancelRequested) {
      const st = p.stage;
      stateText = 'BERJALAN · AKAN BERHENTI setelah ' + (st === 'ai' ? 'batch AI yang sedang berjalan selesai' : st === 'crawl' ? 'work crawl saat ini selesai' : 'tahap saat ini selesai');
    }
  }
  const stateCls = !j ? '' : active ? 'running' : j.status;
  const resumeDisabled = !j || active || !j.resumable || (activeJobs.length > 0 && activeJobs.some((a) => (a.lanes || []).some((l) => (j.lanes || []).includes(l))));
  let pct = p.total ? Math.round((p.done / p.total) * 100) : (j?.status === 'done' ? 100 : 0);
  if (p.companyTotal && p.stage !== 'company') pct = Math.round((((p.companyIndex - 1) + (p.total ? Math.min(1, p.done / p.total) : 0)) / p.companyTotal) * 100);
  const bits: string[] = [];
  if (p.companyTotal) bits.push(p.companyIndex + '/' + p.companyTotal + ' ' + (p.company || '').replace(/^PT\s+/i, ''));
  if (p.stage && !['done', 'error', 'cancelled', 'company'].includes(p.stage)) bits.push(p.stage + (p.work ? ' ' + p.work : ''));
  const stage = bits.join(' · ') || (active ? 'memulai…' : j ? STAT[j.status] || j.status : '–');
  const clockLbl = !j ? 'Durasi' : active ? 'Sudah berjalan' : j.status === 'interrupted' ? 'Berjalan sebelum terputus' : 'Total durasi';

  let note = '';
  if (j && ['interrupted', 'cancelled', 'error'].includes(j.status)) {
    const partial = j.status === 'error' && /^Sebagian selesai/.test(j.error || '');
    const why = partial ? j.error + '.' : j.status === 'interrupted' ? 'Server berhenti atau restart saat job ini berjalan, jadi prosesnya ikut mati.' : j.status === 'cancelled' ? 'Job dihentikan manual.' : 'Job berhenti karena error' + (j.error ? ': ' + j.error : '.');
    note = why + ' Data yang sudah tersimpan aman. ' + (j.resumable
      ? 'Checkpoint: ' + cp.done.length + ' dari ' + cp.total + ' perusahaan sudah selesai. Klik Lanjutkan untuk meneruskan ' + left + ' perusahaan sisanya (perusahaan yang terputus di tengah diulang dari awal; berita yang sudah tersimpan tidak digandakan).'
      : j.resumedFrom ? '' : 'Job ini tidak punya sisa yang bisa dilanjutkan' + (list.some((x) => x.resumedFrom === j.id) ? ' (sudah pernah dilanjutkan).' : '.'));
  }

  const plan = p.plan as { company?: string; total: number; chunkSize: number; concurrency: number; delayMs: number; works: { n: number; state: string; items?: number; failed?: number; ms?: number; jobs: { s: string; m: string; q: string; n?: number; e?: string; k: string }[] }[] } | undefined;
  const rep = j?.reports?.[j.reports.length - 1];
  const sumCols = rep?.perWork?.length ? Object.keys(rep.perWork[0]).filter((k) => k !== 'ms') : [];

  const pages = Math.max(1, Math.ceil(list.length / HIST_PER));
  const goPage = (d: number) => { ctl.current.histPage = Math.max(0, Math.min(pages - 1, ctl.current.histPage + d)); setHistPage(ctl.current.histPage); };

  return (
    <div className="pg-jobs">
      <div className="page">
        <div className="head">
          <h1>Task Runner</h1>
          <p>Jalankan pengambilan data di server, di background. Halaman ini boleh ditutup dan dibuka lagi; job tetap jalan dan log bisa dipantau di sini. Semua pengaturan memakai nilai default terbaik.</p>
        </div>

        <div className="cols">
          <div>
            <h2>Panel kontrol</h2>
            <div className="panel">
              <h3>1. Full pipeline satuan (per perusahaan)</h3>
              <p>Satu perusahaan sekali jalan, berurutan: data keuangan → cari berita → unmask + ambil isi &amp; gambar artikel → klasifikasi AI → rating risiko → analisis AI → dossier.</p>
              <select id="company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                {companies.map((c) => <option key={c.id} value={c.id}>{(c.ticker ? c.ticker + ' · ' : '') + c.name}</option>)}
              </select>
              <button {...B('goOne', { className: 'pri' })} onClick={() => start('portfolio', { companies: [companyId] })}>▶ Mulai full pipeline perusahaan terpilih</button>
            </div>
            <div className="panel">
              <h3>2. Full pipeline (semua perusahaan)</h3>
              <p>Semua perusahaan satu per satu dengan urutan langkah yang sama seperti di atas, dengan jeda antar perusahaan supaya sumber tidak membatasi akses. Berjalan di background.</p>
              <button {...B('goAll', { className: 'pri' })} onClick={() => start('portfolio', {})}>▶ Mulai full pipeline semua perusahaan</button>
              <button {...B('goAllRaw')} onClick={() => start('portfolio', { classify: false, analysis: false })}>▷ Pipeline tanpa AI (AI menyusul)</button>
            </div>
            <div className="panel">
              <h3>3. Lengkapi data tersimpan</h3>
              <p>Untuk data yang diambil sebelum langkah-langkah di atas ada. Tanpa crawl ulang: per perusahaan menjalankan <b>isi &amp; gambar → klasifikasi AI → analisis AI → dossier</b> dengan urutan yang sama seperti crawl. Maks. 300 berita per perusahaan sekali jalan; jalankan lagi bila masih ada sisa.</p>
              <button {...B('goBackfillOne', { className: 'pri' })} onClick={() => start('backfill', { companies: [companyId] })}>▶ Lengkapi perusahaan terpilih (pilihan di panel 1)</button>
              <button {...B('goBackfill')} onClick={() => start('backfill', {})}>▶ Lengkapi semua perusahaan</button>
              <h4 className="sub">Langkah terpisah</h4>
              <button {...B('goContent')} onClick={() => start('content', {})}>1 · Unmask + ambil isi &amp; gambar artikel</button>
              <button {...B('goReclass')} onClick={() => start('reclassify', {})}>2 · Klasifikasi AI ulang</button>
              <button {...B('goAnalysis')} onClick={() => start('analysis', {})}>3 · Buat ulang analisis AI semua perusahaan</button>
              <button className="btn" id="goDossier" title={BTN_TITLE.goDossier} onClick={() => start('dossier', {})}>4 · Buat dossier korporasi semua perusahaan</button>
              <button {...B('goFin')} onClick={() => start('financial', {})}>Perbarui data keuangan semua emiten</button>
              <button {...B('goRescore')} onClick={() => start('rescore', {})}>Hitung ulang keterkaitan nama (tanpa AI)</button>
            </div>
          </div>

          <div>
            <h2>Terminal log aktivitas sistem</h2>
            <div className="term">
              <div className="term-top">
                <span className={'state ' + stateCls} id="state"><i></i><span id="stateText">{stateText}</span></span>
                <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span id="stInfo" style={{ font: '12px ui-monospace,Menlo,monospace', color: 'var(--muted)' }}></span>
                  <button className="btn" id="resume" disabled={resumeDisabled} style={{ width: 'auto', padding: '5px 12px', margin: 0 }}
                    title={j?.resumable ? 'Lanjutkan dari perusahaan yang belum selesai (' + (cp.done.length || 0) + '/' + (cp.total || 0) + ' sudah selesai)' : 'Tidak ada job yang bisa dilanjutkan'} onClick={resume}>Lanjutkan</button>
                  <button className="btn warn" id="cancel" disabled={!active || Boolean(j?.cancelRequested) || cancelling} style={{ width: 'auto', padding: '5px 12px', margin: 0 }} onClick={cancel}>
                    {active && (j?.cancelRequested || cancelling) ? 'Menghentikan…' : 'Hentikan'}
                  </button>
                </span>
              </div>
              <div className="stats">
                <div className="stat"><small>Mulai</small><b id="stStart">{j ? fmtWhen(j.startedAt || j.createdAt) : '–'}</b></div>
                <div className="stat"><small id="stClockLbl">{clockLbl}</small><b className="clock" id="stClock">{j ? fmtDur(durOf(j)) : '--:--:--'}</b></div>
                <div className="stat"><small>Checkpoint</small><b id="stCp" title={'Checkpoint dicatat per perusahaan: perusahaan yang sudah selesai dilewati saat job dilanjutkan.' + (cp.done.length ? ' Selesai: ' + cp.done.map((id) => cmap.current[id] || id).join(', ') : '')}>{j ? (cp.total ? cp.done.length + '/' + cp.total + ' perusahaan selesai' : 'belum ada') : '–'}</b></div>
                <div className="stat"><small>Tahap</small><b id="stStage" title={stage}>{j ? stage : '–'}</b></div>
              </div>
              <div className="note" id="note" hidden={!note}>{note}</div>
              <div className="bar"><div id="barFill" style={{ width: (j ? Math.min(100, j.status === 'done' ? 100 : pct) : 0) + '%' }}></div></div>
              <div id="log" ref={logRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 30; }}>
                {lines.length === 0 && !j && <span className="l"><span className="t">[--:--:--]</span> Task Runner siap menerima instruksi.</span>}
                {lines.map((l, i) => <span className="l" key={i}><span className="t">[{l.t}]</span> <span className={l.cls}>{l.body}</span></span>)}
              </div>
              <div className="term-foot"><span>MySQL · schema media-search</span><button id="clear" type="button" onClick={clear}>Bersihkan log</button></div>
            </div>

            <div className="plan" id="plan" hidden={!(plan && Array.isArray(plan.works) && plan.works.length)}>
              <h4>Rencana crawl: query dan pembagian work</h4>
              {plan && Array.isArray(plan.works) && plan.works.length > 0 && (() => {
                const done = plan.works.filter((w) => w.state === 'selesai' || w.state === 'gagal').length;
                const srcCount: Record<string, number> = {};
                plan.works.forEach((w) => w.jobs.forEach((x) => { srcCount[x.s] = (srcCount[x.s] || 0) + 1; }));
                const kw = [...new Set(plan.works.flatMap((w) => w.jobs.map((x) => x.k)))];
                return (
                  <>
                    <div className="pl-sum" id="planSum">
                      <b>{plan.company || ''}</b>: {plan.total} query dibagi {plan.works.length} work × {plan.chunkSize} query, {plan.concurrency} query paralel di tiap work, jeda {Math.round(plan.delayMs / 1000)} detik antar work. Selesai {done}/{plan.works.length} work.<br />
                      Per sumber: {Object.entries(srcCount).map(([s, n]) => (SRC_LABEL[s] || s) + ' ' + n).join(', ')}. Kata kunci ({kw.length}): {kw.join(' · ')}
                    </div>
                    <div id="planBody">
                      {plan.works.map((w) => {
                        const info = w.state === 'menunggu' ? 'menunggu' : w.state === 'berjalan' ? 'sedang berjalan' : w.items + ' item' + (w.failed ? ' · ' + w.failed + ' query gagal' : '') + (w.ms ? ' · ' + (w.ms / 1000).toFixed(1) + ' dtk' : '');
                        return (
                          <details key={w.n} data-w={w.n} open={planOpen.has(w.n)} onToggle={(e) => {
                            const open = (e.currentTarget as HTMLDetailsElement).open;
                            setPlanOpen((s) => { if (s.has(w.n) === open) return s; const n = new Set(s); if (open) n.add(w.n); else n.delete(w.n); return n; });
                          }}>
                            <summary><b>Work {w.n}/{plan.works.length}</b><span className={'pl-st ' + w.state}>{w.state}</span><span className="sub">{info}</span></summary>
                            <div className="pl-t"><table><thead><tr><th>Sumber</th><th>Modifier</th><th>Query</th><th>Item</th></tr></thead><tbody>
                              {w.jobs.map((x, i) => (
                                <tr key={i}><td>{SRC_LABEL[x.s] || x.s}</td><td>{MOD_LABEL[x.m] || x.m}</td><td className="q">{x.q}</td>
                                  <td className="n">{x.e ? <span title={x.e} style={{ color: '#f87171' }}>gagal</span> : x.n ?? '–'}</td></tr>
                              ))}
                            </tbody></table></div>
                          </details>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </div>

            <StepsHelp />

            <div className="sum" id="sum" hidden={!sumCols.length}>
              <h4>Ringkasan hasil</h4>
              <div id="sumBody">
                {sumCols.length > 0 && (
                  <table><thead><tr>{sumCols.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>
                    {rep!.perWork!.map((r, i) => <tr key={i}>{sumCols.map((c) => <td key={c}>{String(r[c] ?? '')}</td>)}</tr>)}
                  </tbody></table>
                )}
              </div>
            </div>

            <div className="hist">
              <h4>Riwayat job</h4>
              <div id="hist">
                {list.slice(histPage * HIST_PER, (histPage + 1) * HIST_PER).map((x) => {
                  const c = x.checkpoint || { done: [], total: 0 };
                  return (
                    <div key={x.id} className={'hrow ' + x.status + (x.id === jobId ? ' on' : '')} data-id={x.id} onClick={() => select(x.id)}>
                      <span className="dot"></span>
                      <div style={{ minWidth: 0 }}>
                        <div className="nm">{jobLabel(x)}</div>
                        <div className="sub">mulai {fmtWhen(x.startedAt || x.createdAt)}
                          {x.resumable ? <> · <span className="rs">↻ checkpoint {c.done.length}/{c.total}, bisa dilanjutkan</span></> : x.resumedFrom ? ' · lanjutan dari ' + x.resumedFrom : ''}</div>
                      </div>
                      <div className="rt"><b data-dur={x.id}>{fmtDur(durOf(x))}</b>{STAT[x.status] || x.status}</div>
                    </div>
                  );
                })}
                {list.length === 0 && <div className="hrow"><span></span><span className="sub">Belum ada job.</span></div>}
              </div>
              <div className="hpg" id="histPg">
                {pages > 1 && (
                  <>
                    <button type="button" disabled={histPage === 0} onClick={() => goPage(-1)}>‹ Lebih baru</button>
                    <span>Halaman {histPage + 1} dari {pages} · {list.length} job</span>
                    <button type="button" disabled={histPage >= pages - 1} onClick={() => goPage(1)}>Lebih lama ›</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
