'use client';
/* Tab Keuangan: ringkasan mudah dibaca (kartu kesehatan) + rincian yang bisa ditelusuri (angka utama, grafik, tabel). Semua dihitung dengan aturan tetap, tanpa AI. */
import { type ReactNode, useId } from 'react';
import { compact, dt, money, nf, safeUrl } from '@/lib/client/format';
import type { OverviewCtx } from './CompanyPage';

/* ---------- helper hitung ---------- */
type Q = Record<string, any> & { asOf: string };
// Periode pembanding: kuartal yang sama tahun lalu (YoY); kalau tidak ada, kuartal sebelumnya (QoQ).
function prevOf(list: Q[], i = 0) {
  const q = list[i];
  const y = list.find((x) => x.asOf.slice(5) === q.asOf.slice(5) && Number(x.asOf.slice(0, 4)) === Number(q.asOf.slice(0, 4)) - 1);
  return y ? { p: y, label: 'YoY' } : list[i + 1] ? { p: list[i + 1], label: 'QoQ' } : null;
}
type Growth = { pct: number; label: string; from: number; fromDate: string; to: number; toDate: string };
function growth(list: Q[], key: string): Growth | null {
  if (!list[0] || list[0][key] == null) return null;
  const pv = prevOf(list, 0);
  if (!pv || pv.p[key] == null || pv.p[key] === 0) return null;
  return { pct: ((list[0][key] - pv.p[key]) / Math.abs(pv.p[key])) * 100, label: pv.label, from: pv.p[key], fromDate: pv.p.asOf, to: list[0][key], toDate: list[0].asOf };
}
const Chip = ({ g }: { g: Growth | null }) => (g ? <span className={'tag ' + (g.pct < 0 ? 't-red' : 't-green')}>{g.pct > 0 ? '▲' : '▼'} {nf(Math.abs(g.pct), 1)}% {g.label}</span> : null);
const ratio = (a: number | null | undefined, b: number | null | undefined, pct = true): number | null => (a == null || !b ? null : pct ? (a / b) * 100 : a / b);
const pc = (n: number | null | undefined, d = 1) => (n == null ? '–' : nf(n, d) + '%');
const xx = (n: number | null | undefined) => (n == null ? '–' : nf(n, 2) + 'x');

/* ---------- grafik ---------- */
function BarChart({ list, k }: { list: Q[]; k: string }) {
  const rows = [...list].reverse().filter((q) => q[k] != null);
  if (!rows.length) return <div className="muted sm" style={{ padding: '26px 0' }}>Data tidak tersedia untuk perusahaan ini.</div>;
  const max = Math.max(...rows.map((r) => Math.abs(r[k]))) || 1;
  return (
    <>
      <div className="bars">{rows.map((r) => (
        <div className="b" key={r.asOf} title={`${r.asOf}: ${r[k]}`}><em>{compact(r[k])}</em><i className={r[k] < 0 ? 'neg' : ''} style={{ height: Math.max(2, (Math.abs(r[k]) / max) * 100) + '%' }}></i></div>
      ))}</div>
      <div className="bl">{rows.map((r) => <span key={r.asOf}>{r.asOf.slice(0, 7)}</span>)}</div>
    </>
  );
}

function LineChart({ series, labels }: { series: { name: string; color: string; vals: (number | null)[] }[]; labels: string[] }) {
  const all = series.flatMap((s) => s.vals).filter((v): v is number => v != null);
  if (all.length < 2) return <div className="muted sm" style={{ padding: '26px 0' }}>Data margin tidak cukup.</div>;
  const W = 520, H = 170, P = 26, min = Math.min(0, ...all), max = Math.max(...all), rg = max - min || 1;
  const x = (i: number) => P + (i / Math.max(1, labels.length - 1)) * (W - P * 2);
  const y = (v: number) => H - 24 - ((v - min) / rg) * (H - 44);
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        {[min, (min + max) / 2, max].map((g, i) => <g key={i}><line x1={P} x2={W - P} y1={y(g)} y2={y(g)} stroke="#232932" /><text x="2" y={y(g) + 4} fill="#5b636e" fontSize="10">{nf(g, 0)}%</text></g>)}
        {min < 0 && <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke="#4a5360" strokeDasharray="3 3" />}
        {series.map((s) => {
          const pts = s.vals.map((v, i) => (v == null ? null : [x(i), y(v)] as [number, number]));
          const d = pts.map((p, i) => (p ? `${pts.slice(0, i).some(Boolean) && pts[i - 1] ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}` : '')).join(' ');
          return <g key={s.name}><path d={d} fill="none" stroke={s.color} strokeWidth="2" />{pts.map((p, i) => (p ? <rect key={i} x={p[0] - 3} y={p[1] - 3} width="6" height="6" fill={s.color} /> : null))}</g>;
        })}
        {labels.map((l, i) => <text key={i} x={x(i)} y={H - 6} fill="#5b636e" fontSize="10" textAnchor="middle">{l}</text>)}
      </svg>
      <div className="row sm muted" style={{ gap: 16, marginTop: 6 }}>
        {series.map((s) => <span className="row" style={{ gap: 6 }} key={s.name}><i style={{ width: 10, height: 10, background: s.color, display: 'inline-block' }}></i>{s.name}</span>)}
      </div>
    </>
  );
}

function PriceChart({ series }: { series?: [number, number][] }) {
  const gid = useId();
  if (!series || series.length < 2) return <div className="muted sm" style={{ padding: '26px 0' }}>Grafik harga tidak tersedia.</div>;
  const W = 520, H = 170, P = 38, v = series.map((s) => s[1]);
  const min = Math.min(...v), max = Math.max(...v), rg = max - min || 1;
  const x = (i: number) => P + (i / (v.length - 1)) * (W - P - 8), y = (val: number) => H - 22 - ((val - min) / rg) * (H - 40);
  const up = v[v.length - 1] >= v[0], col = up ? '#2fbf71' : '#ef5b5b';
  const d = v.map((val, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(val).toFixed(1)}`).join(' ');
  const t = (ts: number) => new Date(ts * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      <defs><linearGradient id={gid} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={col} stopOpacity=".22" /><stop offset="1" stopColor={col} stopOpacity="0" /></linearGradient></defs>
      {[min, (min + max) / 2, max].map((g, i) => <g key={i}><line x1={P} x2={W - 8} y1={y(g)} y2={y(g)} stroke="#232932" /><text x="2" y={y(g) + 4} fill="#5b636e" fontSize="10">{nf(g, 0)}</text></g>)}
      <path d={`${d} L${x(v.length - 1)},${H - 22} L${x(0)},${H - 22} Z`} fill={`url(#${gid})`} /><path d={d} fill="none" stroke={col} strokeWidth="2" />
      <text x={P} y={H - 6} fill="#5b636e" fontSize="10">{t(series[0][0])}</text><text x={W - 8} y={H - 6} fill="#5b636e" fontSize="10" textAnchor="end">{t(series[series.length - 1][0])}</text>
    </svg>
  );
}

/* ---------- kartu kesehatan keuangan (ringkas, bisa dibuka rinciannya) ---------- */
const ST: Record<string, [string, string]> = { baik: ['t-green', 'Baik'], waspada: ['t-amber', 'Waspada'], buruk: ['t-red', 'Perlu perhatian'], na: ['t-gray', 'Tidak tersedia'] };
type HCard = { title: string; status: string; headline: string; calc: { label: string; value: string }[]; note?: string };

function healthCards(fin: any, company: any): HCard[] {
  const q: Q[] = fin.fundamentals?.quarterly || [], v = fin.valuation || {}, cur = fin.fundamentals?.currency || '';
  const L: Record<string, any> = q[0] || {};
  const isBank = /bank|perbankan/i.test(`${company.sector} ${company.name}`);
  const cards: HCard[] = [];
  const row = (label: string, value: string) => ({ label, value });
  const add = (title: string, status: string, headline: string, calc: (false | null | undefined | { label: string; value: string })[], note?: string) => cards.push({ title, status, headline, calc: calc.filter(Boolean) as { label: string; value: string }[], note });

  // 1. Profitabilitas
  const nm = ratio(L.NetIncome, L.TotalRevenue), gm = ratio(L.GrossProfit, L.TotalRevenue), om = ratio(L.OperatingIncome, L.TotalRevenue);
  if (nm == null) add('Profitabilitas', 'na', 'Data laba/pendapatan tidak tersedia.', []);
  else add('Profitabilitas', nm >= 10 ? 'baik' : nm >= 3 ? 'waspada' : 'buruk',
    nm >= 10 ? `Menguntungkan: tiap Rp100 pendapatan menyisakan ±Rp${nf(nm, 0)} laba bersih.` : nm >= 3 ? `Laba tipis: hanya ±Rp${nf(nm, 0)} laba bersih tiap Rp100 pendapatan.` : nm < 0 ? 'Rugi bersih pada kuartal terakhir.' : `Margin sangat tipis (${nf(nm, 1)}%).`,
    [row(`Laba bersih ${L.asOf}`, money(L.NetIncome, cur)), row('Pendapatan', money(L.TotalRevenue, cur)), row('Margin bersih = laba bersih ÷ pendapatan', pc(nm)), row('Margin kotor', pc(gm)), row('Margin operasi', pc(om))],
    'Ambang: ≥10% baik, 3–10% waspada, <3% perlu perhatian.');

  // 2. Pertumbuhan
  const gr = growth(q, 'TotalRevenue'), gn = growth(q, 'NetIncome');
  if (!gr && !gn) add('Pertumbuhan', 'na', 'Belum ada periode pembanding.', []);
  else {
    const rv = gr?.pct, ni = gn?.pct;
    const st = (rv != null && rv < -10) || (ni != null && ni < -20) ? 'buruk' : (rv != null && rv < 0) || (ni != null && ni < 0) ? 'waspada' : 'baik';
    add('Pertumbuhan', st, `Pendapatan ${rv == null ? '–' : (rv >= 0 ? 'naik ' : 'turun ') + nf(Math.abs(rv), 1) + '%'}, laba bersih ${ni == null ? '–' : (ni >= 0 ? 'naik ' : 'turun ') + nf(Math.abs(ni), 1) + '%'} (${(gr || gn)!.label}).`,
      [gr && row(`Pendapatan ${gr.toDate} vs ${gr.fromDate}`, `${money(gr.to, cur)} vs ${money(gr.from, cur)} → ${pc(gr.pct)}`), gn && row(`Laba bersih ${gn.toDate} vs ${gn.fromDate}`, `${money(gn.to, cur)} vs ${money(gn.from, cur)} → ${pc(gn.pct)}`)],
      'Ambang: pendapatan turun >10% atau laba turun >20% = perlu perhatian; turun tipis = waspada.');
  }

  // 3. Utang
  const der = ratio(L.TotalDebt, L.StockholdersEquity), ic = L.InterestExpense ? ratio(L.OperatingIncome, Math.abs(L.InterestExpense), false) : null;
  if (isBank) add('Utang & solvabilitas', 'na', 'Rasio utang industri umum tidak relevan untuk bank (dana pihak ketiga dihitung beda).', [row('Total ekuitas', money(L.StockholdersEquity, cur))]);
  else if (der == null) add('Utang & solvabilitas', 'na', 'Data utang/ekuitas tidak tersedia.', []);
  else add('Utang & solvabilitas', der < 100 && (ic == null || ic >= 3) ? 'baik' : der < 200 && (ic == null || ic >= 1.5) ? 'waspada' : 'buruk',
    `Utang ${nf(der, 0)}% dari ekuitas${ic != null ? `; laba operasi menutup bunga ${nf(ic, 1)}x` : ''}.`,
    [row('Total utang', money(L.TotalDebt, cur)), row('Ekuitas', money(L.StockholdersEquity, cur)), row('Debt/Equity = utang ÷ ekuitas', pc(der, 0)), ic != null && row('Interest coverage = laba operasi ÷ beban bunga', xx(ic))],
    'Ambang: DER <100% & coverage ≥3x baik; <200% & ≥1,5x waspada; selebihnya perlu perhatian.');

  // 4. Likuiditas & kas
  const cr = ratio(L.CurrentAssets, L.CurrentLiabilities, false);
  if (cr == null && L.CashAndCashEquivalents == null) add('Likuiditas & kas', 'na', isBank ? 'Tidak relevan untuk bank.' : 'Data likuiditas tidak tersedia.', []);
  else add('Likuiditas & kas', cr == null ? 'na' : cr >= 1.5 ? 'baik' : cr >= 1 ? 'waspada' : 'buruk',
    cr == null ? `Kas & setara kas ${money(L.CashAndCashEquivalents, cur)}.` : `Aset lancar ${nf(cr, 2)}x kewajiban jangka pendek${cr < 1 ? ' (berpotensi kesulitan membayar kewajiban dekat)' : ''}.`,
    [row('Aset lancar', money(L.CurrentAssets, cur)), row('Liabilitas jangka pendek', money(L.CurrentLiabilities, cur)), row('Current ratio', xx(cr)), row('Kas & setara kas', money(L.CashAndCashEquivalents, cur))],
    'Ambang: ≥1,5x baik, 1–1,5x waspada, <1x perlu perhatian.');

  // 5. Arus kas
  const fcf = L.FreeCashFlow;
  if (fcf == null) add('Arus kas bebas', 'na', 'Data free cash flow tidak tersedia.', []);
  else add('Arus kas bebas', fcf > 0 ? 'baik' : 'buruk', fcf > 0 ? `Kas bebas positif ${money(fcf, cur)}: usaha menghasilkan kas setelah belanja modal.` : `Kas bebas negatif ${money(fcf, cur)}: belanja modal melebihi kas operasi.`,
    [row(`Free cash flow ${L.asOf}`, money(fcf, cur)), row('EBITDA', money(L.EBITDA, cur)), L.NetIncome != null && row('Kas bebas ÷ laba bersih', L.NetIncome ? pc((fcf / L.NetIncome) * 100, 0) : '–')],
    'Free cash flow = arus kas operasi − belanja modal (angka dari sumber data).');

  // 6. Valuasi
  if (v.per == null && v.pbv == null) add('Valuasi', 'na', fin.valuation ? 'PER tidak bermakna (laba negatif).' : 'Data valuasi tidak tersedia.', [row('PBV', xx(v.pbv))]);
  else add('Valuasi', v.per != null && v.per <= 15 ? 'baik' : v.per != null && v.per <= 25 ? 'waspada' : 'buruk',
    `Harga ${xx(v.per)} laba tahunan (PER) dan ${xx(v.pbv)} nilai buku (PBV)${v.per != null && v.per <= 15 ? ': relatif murah' : v.per > 25 ? ': relatif mahal' : ''}.`,
    [row('PER (harga ÷ laba per saham)', xx(v.per)), row('Forward PER', xx(v.forwardPer)), row('PBV (harga ÷ nilai buku)', xx(v.pbv)), row('EPS', nf(v.eps, 2)), row('Market cap', money(v.marketCap, fin.price?.currency))],
    'Perbandingan paling adil adalah dengan emiten sejenis; ambang ini hanya patokan umum.');

  // 7. Dividen
  if (v.dividendYieldPct == null) add('Dividen', 'na', 'Data dividen tidak tersedia.', []);
  else add('Dividen', v.dividendYieldPct >= 3 && (v.payoutRatioPct == null || v.payoutRatioPct <= 100) ? 'baik' : v.dividendYieldPct > 0 ? 'waspada' : 'na',
    v.dividendYieldPct > 0 ? `Imbal hasil dividen ${nf(v.dividendYieldPct, 1)}%${v.payoutRatioPct > 100 ? `; payout ${nf(v.payoutRatioPct, 0)}% melebihi laba, sulit dipertahankan` : ''}.` : 'Tidak membagikan dividen.',
    [row('Dividend yield', pc(v.dividendYieldPct)), row('Payout ratio (dividen ÷ laba)', pc(v.payoutRatioPct, 0)), row('Dividen 3 bulan terakhir', (fin.price?.dividends3m || []).map((d: any) => `${d.date}: ${nf(d.amount, 2)}`).join(', ') || '–')],
    'Payout >100% berarti dividen dibayar lebih besar dari laba periode itu.');
  return cards;
}

const HIST_HEAD = (
  <tr><th>Periode</th><th>Pendapatan</th><th>Laba kotor</th><th>Laba operasi</th><th>EBITDA</th><th>Laba bersih</th><th>Free cash flow</th><th>Kas</th><th>Total aset</th><th>Total utang</th><th>Ekuitas</th></tr>
);

/* ---------- tab Keuangan ---------- */
export default function TabKeuangan({ data }: OverviewCtx) {
  const { financial: fin, financialError, company: c } = data;
  if (c.type !== 'public') return <div className="empty"><b>Perusahaan tertutup</b>Tidak ada kewajiban publikasi laporan keuangan. Sinyal pendanaan, gugatan, PHK, dan pergantian direksi dipantau lewat berita.</div>;
  if (!fin) return <div className="empty"><b>Data keuangan tidak tersedia</b>{financialError || ''}</div>;

  const v = fin.valuation, f = fin.fundamentals || { quarterly: [], annual: [] };
  const q: Q[] = f.quarterly, an: Q[] = f.annual;
  const cur = f.currency || fin.price?.currency || '', mc = fin.price?.currency || cur;
  const health = healthCards(fin, c);
  const cnt: Record<string, number> = { baik: 0, waspada: 0, buruk: 0 };
  health.forEach((h) => { if (cnt[h.status] != null) cnt[h.status]++; });

  const hl = (label: string, val: ReactNode, g: Growth | null, sub?: ReactNode) => <div><small>{label}</small><div className="v">{val}</div><div className="s"><Chip g={g} />{sub ? <span>{sub}</span> : null}</div></div>;
  const fy = (key: string) => (an[0]?.[key] != null ? `FY ${an[0].asOf.slice(0, 4)}: ${money(an[0][key], cur)}` : '');
  const old = [...q].reverse();
  const labels = old.map((x) => x.asOf.slice(0, 7));
  const margin = (key: string, base = 'TotalRevenue') => old.map((x) => ratio(x[key], x[base]));
  const tile = (l: string, val: string) => <div key={l}><small>{l}</small><div className="v" style={{ fontSize: 19 }}>{val}</div></div>;
  const rows = (list: Q[]) => list.map((r) => (
    <tr key={r.asOf}><td>{r.asOf}</td><td>{money(r.TotalRevenue, cur)}</td><td>{money(r.GrossProfit, cur)}</td><td>{money(r.OperatingIncome, cur)}</td><td>{money(r.EBITDA, cur)}</td>
      <td className={r.NetIncome < 0 ? 'down' : ''}>{money(r.NetIncome, cur)}</td><td>{money(r.FreeCashFlow, cur)}</td><td>{money(r.CashAndCashEquivalents, cur)}</td><td>{money(r.TotalAssets, cur)}</td><td>{money(r.TotalDebt, cur)}</td><td>{money(r.StockholdersEquity, cur)}</td></tr>
  ));

  return (
    <>
      <div className="row" style={{ marginTop: 22, justifyContent: 'space-between' }}>
        <h4 style={{ margin: 0 }}>Kesehatan keuangan <span className="muted sm">· kuartal {q[0]?.asOf || '-'}</span></h4>
        <span className="row" style={{ gap: 6 }}><span className="tag t-green">{cnt.baik} baik</span><span className="tag t-amber">{cnt.waspada} waspada</span><span className="tag t-red">{cnt.buruk} perlu perhatian</span></span>
      </div>
      <div className="health">{health.map((h) => (
        <details className={'hc st-' + h.status} key={h.title}>
          <summary>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}><b>{h.title}</b><span className={'tag ' + ST[h.status][0]}>{ST[h.status][1]}</span></div>
            <div className="hh">{h.headline}</div>
            {h.calc.length > 0 && <div className="more">Lihat perhitungan ▾</div>}
          </summary>
          {h.calc.length > 0 && (
            <div className="calc">
              {h.calc.map((r) => <div className="kv" key={r.label}><span style={{ border: 0 }}>{r.label}</span><b>{String(r.value)}</b></div>)}
              {h.note && <div className="sm dim" style={{ marginTop: 8 }}>{h.note}</div>}
            </div>
          )}
        </details>
      ))}</div>
      {fin.signals?.length > 0 && (
        <div className="row" style={{ marginTop: 12 }}>{fin.signals.map((s: any, i: number) => (
          <span key={i} className={'tag ' + (s.level === 'baik' ? 't-green' : 't-red')} style={{ whiteSpace: 'normal', padding: '6px 10px' }}>{s.level === 'baik' ? '▲' : '▼'} {s.text}</span>
        ))}</div>
      )}

      <h4>Angka utama <span className="muted sm">· kuartal terakhir ({cur}), dibanding periode yang sama tahun lalu</span></h4>
      <div className="hl">
        {hl('Pendapatan', money(q[0]?.TotalRevenue, cur), growth(q, 'TotalRevenue'), fy('TotalRevenue'))}
        {hl('Laba bersih', money(q[0]?.NetIncome, cur), growth(q, 'NetIncome'), fy('NetIncome'))}
        {hl('EBITDA', money(q[0]?.EBITDA, cur), growth(q, 'EBITDA'), fy('EBITDA'))}
        {hl('Free cash flow', money(q[0]?.FreeCashFlow, cur), growth(q, 'FreeCashFlow'), fy('FreeCashFlow'))}
        {hl('Kas & setara kas', money(q[0]?.CashAndCashEquivalents, cur), growth(q, 'CashAndCashEquivalents'))}
        {hl('Kapitalisasi pasar', money(v?.marketCap, mc), null, v?.per != null ? `PER ${nf(v.per, 1)}x · PBV ${nf(v.pbv, 2)}x` : '')}
      </div>

      <h4>Grafik</h4>
      <div className="charts">
        <div className="card"><div className="ct">Harga saham · 3 bulan</div><PriceChart series={fin.price?.series} /></div>
        <div className="card"><div className="ct">Margin (% dari pendapatan)</div>
          <LineChart labels={labels} series={[{ name: 'Kotor', color: '#4c8dff', vals: margin('GrossProfit') }, { name: 'Operasi', color: '#fbbf24', vals: margin('OperatingIncome') }, { name: 'Bersih', color: '#2fbf71', vals: margin('NetIncome') }]} /></div>
        <div className="card"><div className="ct">Pendapatan per kuartal</div><BarChart list={q} k="TotalRevenue" /></div>
        <div className="card"><div className="ct">Laba bersih per kuartal</div><BarChart list={q} k="NetIncome" /></div>
        <div className="card"><div className="ct">EBITDA per kuartal</div><BarChart list={q} k="EBITDA" /></div>
        <div className="card"><div className="ct">Free cash flow per kuartal</div><BarChart list={q} k="FreeCashFlow" /></div>
      </div>

      {v && (
        <>
          <h4>Valuasi &amp; imbal hasil</h4>
          <div className="hl">
            {tile('PER', nf(v.per, 1) + 'x')}{tile('Forward PER', nf(v.forwardPer, 1) + 'x')}{tile('PBV', nf(v.pbv, 2) + 'x')}{tile('EPS', nf(v.eps, 2))}
            {tile('Dividend yield', v.dividendYieldPct == null ? '–' : nf(v.dividendYieldPct, 1) + '%')}{tile('Payout ratio', v.payoutRatioPct == null ? '–' : nf(v.payoutRatioPct, 1) + '%')}
            {tile('ROE', v.roePct == null ? '–' : nf(v.roePct, 1) + '%')}{tile('Beta', nf(v.beta, 2))}
          </div>
        </>
      )}

      <h4>Rincian lengkap <span className="muted sm">· untuk menelusuri angka</span></h4>
      {q.length > 0 && (
        <>
          <details className="card tbl" open><summary>Laporan keuangan per kuartal</summary><div className="scroll"><table><thead>{HIST_HEAD}</thead><tbody>{rows(q)}</tbody></table></div></details>
          <details className="card tbl"><summary>Laporan keuangan tahunan</summary><div className="scroll"><table><thead>{HIST_HEAD}</thead><tbody>{rows(an)}</tbody></table></div></details>
          <details className="card tbl"><summary>Margin &amp; rasio per kuartal</summary><div className="scroll"><table><thead><tr><th>Periode</th><th>Margin kotor</th><th>Margin operasi</th><th>Margin bersih</th><th>Margin EBITDA</th><th>Debt / Equity</th><th>Current ratio</th><th>Interest coverage</th></tr></thead>
            <tbody>{q.map((x) => (
              <tr key={x.asOf}><td>{x.asOf}</td><td>{pc(ratio(x.GrossProfit, x.TotalRevenue))}</td><td>{pc(ratio(x.OperatingIncome, x.TotalRevenue))}</td><td className={x.NetIncome < 0 ? 'down' : ''}>{pc(ratio(x.NetIncome, x.TotalRevenue))}</td>
                <td>{pc(ratio(x.EBITDA, x.TotalRevenue))}</td><td>{pc(ratio(x.TotalDebt, x.StockholdersEquity), 0)}</td><td>{xx(ratio(x.CurrentAssets, x.CurrentLiabilities, false))}</td>
                <td>{xx(x.InterestExpense ? ratio(x.OperatingIncome, Math.abs(x.InterestExpense), false) : null)}</td></tr>
            ))}</tbody></table></div></details>
        </>
      )}
      {fin.price?.dividends3m?.length > 0 && (
        <details className="card tbl"><summary>Dividen (3 bulan terakhir)</summary>
          {fin.price.dividends3m.map((d: any) => <div className="kv" key={d.date}><span>{d.date}</span><b>{nf(d.amount, 2)} {fin.price.currency}</b></div>)}
        </details>
      )}
      <details className="card tbl"><summary>Pengumuman bursa (IDX, 90 hari)</summary>
        {fin.announcements?.length ? fin.announcements.map((a: any, i: number) => (
          <div className="kv" key={i}><span style={{ border: 0, color: 'var(--text)' }}>{a.url ? <a href={safeUrl(a.url)} target="_blank" rel="noopener" style={{ color: 'var(--cyan)' }}>{a.title}</a> : a.title}</span><b className="dim sm">{a.date}</b></div>
        )) : <div className="muted" style={{ padding: '8px 0' }}>{fin.errors?.announcements || 'Tidak ada pengumuman.'}{fin.errors?.announcements ? ' — situs IDX kadang memblokir akses otomatis.' : ''}</div>}
      </details>
      <div className="sm dim" style={{ marginTop: 14 }}>Sumber: Yahoo Finance &amp; IDX, per {dt(fin.fetchedAt)}. Kartu kesehatan dihitung dengan aturan tetap dari angka di bawahnya (tanpa AI); beberapa metrik tidak tersedia untuk sektor tertentu, mis. EBITDA untuk bank.</div>
    </>
  );
}
