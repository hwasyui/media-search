/* Tab Keuangan (ringkasan mudah dibaca + rincian yang bisa ditelusuri) dan kartu Analisis AI untuk portal.html.
   Memakai helper global dari portal.html: $, esc, nf, money, api, CS, safeUrl, ago, toast, tag classes. */
'use strict';

/* ---------- helper hitung ---------- */
const compact = (n) => { if (n == null) return '–'; const a = Math.abs(n), sg = n < 0 ? '-' : ''; return sg + (a >= 1e12 ? nf(a / 1e12, 1) + 'T' : a >= 1e9 ? nf(a / 1e9, 1) + 'M' : a >= 1e6 ? nf(a / 1e6, 1) + 'jt' : nf(a, 0)); };
// Periode pembanding: kuartal yang sama tahun lalu (YoY); kalau tidak ada, kuartal sebelumnya (QoQ).
function prevOf(list, i = 0) {
  const q = list[i];
  const y = list.find((x) => x.asOf.slice(5) === q.asOf.slice(5) && Number(x.asOf.slice(0, 4)) === Number(q.asOf.slice(0, 4)) - 1);
  return y ? { p: y, label: 'YoY' } : list[i + 1] ? { p: list[i + 1], label: 'QoQ' } : null;
}
function growth(list, key) {
  if (!list[0] || list[0][key] == null) return null;
  const pv = prevOf(list, 0);
  if (!pv || pv.p[key] == null || pv.p[key] === 0) return null;
  return { pct: ((list[0][key] - pv.p[key]) / Math.abs(pv.p[key])) * 100, label: pv.label, from: pv.p[key], fromDate: pv.p.asOf, to: list[0][key], toDate: list[0].asOf };
}
const chip = (g) => (g ? `<span class="tag ${g.pct < 0 ? 't-red' : 't-green'}">${g.pct > 0 ? '▲' : '▼'} ${nf(Math.abs(g.pct), 1)}% ${g.label}</span>` : '');
const ratio = (a, b, pct = true) => (a == null || !b ? null : pct ? (a / b) * 100 : a / b);
const pc = (n, d = 1) => (n == null ? '–' : nf(n, d) + '%');
const xx = (n) => (n == null ? '–' : nf(n, 2) + 'x');

/* ---------- grafik ---------- */
function barChart(list, key) {
  const rows = [...list].reverse().filter((q) => q[key] != null);
  if (!rows.length) return '<div class="muted sm" style="padding:26px 0">Data tidak tersedia untuk perusahaan ini.</div>';
  const max = Math.max(...rows.map((r) => Math.abs(r[key]))) || 1;
  return `<div class="bars">${rows.map((r) => `<div class="b" title="${esc(r.asOf)}: ${esc(String(r[key]))}"><em>${compact(r[key])}</em><i class="${r[key] < 0 ? 'neg' : ''}" style="height:${Math.max(2, (Math.abs(r[key]) / max) * 100)}%"></i></div>`).join('')}</div>
    <div class="bl">${rows.map((r) => `<span>${esc(r.asOf.slice(0, 7))}</span>`).join('')}</div>`;
}
function lineChart(series, labels) {
  // series: [{name,color,vals:[...]}] urut lama -> baru; vals boleh null
  const all = series.flatMap((s) => s.vals).filter((v) => v != null);
  if (all.length < 2) return '<div class="muted sm" style="padding:26px 0">Data margin tidak cukup.</div>';
  const W = 520, H = 170, P = 26, min = Math.min(0, ...all), max = Math.max(...all), rg = max - min || 1;
  const x = (i) => P + (i / Math.max(1, labels.length - 1)) * (W - P * 2);
  const y = (v) => H - 24 - ((v - min) / rg) * (H - 44);
  const grid = [min, (min + max) / 2, max].map((g) => `<line x1="${P}" x2="${W - P}" y1="${y(g)}" y2="${y(g)}" stroke="#232932"/><text x="2" y="${y(g) + 4}" fill="#5b636e" font-size="10">${nf(g, 0)}%</text>`).join('');
  const zero = min < 0 ? `<line x1="${P}" x2="${W - P}" y1="${y(0)}" y2="${y(0)}" stroke="#4a5360" stroke-dasharray="3 3"/>` : '';
  const lines = series.map((s) => {
    const pts = s.vals.map((v, i) => (v == null ? null : [x(i), y(v)]));
    const d = pts.map((p, i) => (p ? `${pts.slice(0, i).some(Boolean) && pts[i - 1] ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}` : '')).join(' ');
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"/>${pts.map((p) => (p ? `<rect x="${p[0] - 3}" y="${p[1] - 3}" width="6" height="6" fill="${s.color}"/>` : '')).join('')}`;
  }).join('');
  const xl = labels.map((l, i) => `<text x="${x(i)}" y="${H - 6}" fill="#5b636e" font-size="10" text-anchor="middle">${esc(l)}</text>`).join('');
  const legend = series.map((s) => `<span class="row" style="gap:6px"><i style="width:10px;height:10px;background:${s.color};display:inline-block"></i>${esc(s.name)}</span>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${grid}${zero}${lines}${xl}</svg><div class="row sm muted" style="gap:16px;margin-top:6px">${legend}</div>`;
}
function priceChart(series) {
  if (!series || series.length < 2) return '<div class="muted sm" style="padding:26px 0">Grafik harga tidak tersedia.</div>';
  const W = 520, H = 170, P = 38, v = series.map((s) => s[1]);
  const min = Math.min(...v), max = Math.max(...v), rg = max - min || 1;
  const x = (i) => P + (i / (v.length - 1)) * (W - P - 8), y = (val) => H - 22 - ((val - min) / rg) * (H - 40);
  const up = v.at(-1) >= v[0], col = up ? '#2fbf71' : '#ef5b5b';
  const d = v.map((val, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(val).toFixed(1)}`).join(' ');
  const t = (ts) => new Date(ts * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block"><defs><linearGradient id="pg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".22"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    ${[min, (min + max) / 2, max].map((g) => `<line x1="${P}" x2="${W - 8}" y1="${y(g)}" y2="${y(g)}" stroke="#232932"/><text x="2" y="${y(g) + 4}" fill="#5b636e" font-size="10">${nf(g, 0)}</text>`).join('')}
    <path d="${d} L${x(v.length - 1)},${H - 22} L${x(0)},${H - 22} Z" fill="url(#pg)"/><path d="${d}" fill="none" stroke="${col}" stroke-width="2"/>
    <text x="${P}" y="${H - 6}" fill="#5b636e" font-size="10">${t(series[0][0])}</text><text x="${W - 8}" y="${H - 6}" fill="#5b636e" font-size="10" text-anchor="end">${t(series.at(-1)[0])}</text></svg>`;
}

/* ---------- kartu kesehatan keuangan (ringkas, bisa dibuka rinciannya) ---------- */
const ST = { baik: ['t-green', 'Baik'], waspada: ['t-amber', 'Waspada'], buruk: ['t-red', 'Perlu perhatian'], na: ['t-gray', 'Tidak tersedia'] };
function healthCards(fin, company) {
  const q = fin.fundamentals?.quarterly || [], an = fin.fundamentals?.annual || [], v = fin.valuation || {}, cur = fin.fundamentals?.currency || '';
  const L = q[0] || {};
  const isBank = /bank|perbankan/i.test(`${company.sector} ${company.name}`);
  const cards = [];
  const row = (label, value) => ({ label, value });
  const add = (title, status, headline, calc, note) => cards.push({ title, status, headline, calc, note });

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
    add('Pertumbuhan', st, `Pendapatan ${rv == null ? '–' : (rv >= 0 ? 'naik ' : 'turun ') + nf(Math.abs(rv), 1) + '%'}, laba bersih ${ni == null ? '–' : (ni >= 0 ? 'naik ' : 'turun ') + nf(Math.abs(ni), 1) + '%'} (${(gr || gn).label}).`,
      [gr && row(`Pendapatan ${gr.toDate} vs ${gr.fromDate}`, `${money(gr.to, cur)} vs ${money(gr.from, cur)} → ${pc(gr.pct)}`), gn && row(`Laba bersih ${gn.toDate} vs ${gn.fromDate}`, `${money(gn.to, cur)} vs ${money(gn.from, cur)} → ${pc(gn.pct)}`)].filter(Boolean),
      'Ambang: pendapatan turun >10% atau laba turun >20% = perlu perhatian; turun tipis = waspada.');
  }

  // 3. Utang
  const der = ratio(L.TotalDebt, L.StockholdersEquity), ic = L.InterestExpense ? ratio(L.OperatingIncome, Math.abs(L.InterestExpense), false) : null;
  if (isBank) add('Utang & solvabilitas', 'na', 'Rasio utang industri umum tidak relevan untuk bank (dana pihak ketiga dihitung beda).', [row('Total ekuitas', money(L.StockholdersEquity, cur))]);
  else if (der == null) add('Utang & solvabilitas', 'na', 'Data utang/ekuitas tidak tersedia.', []);
  else add('Utang & solvabilitas', der < 100 && (ic == null || ic >= 3) ? 'baik' : der < 200 && (ic == null || ic >= 1.5) ? 'waspada' : 'buruk',
    `Utang ${nf(der, 0)}% dari ekuitas${ic != null ? `; laba operasi menutup bunga ${nf(ic, 1)}x` : ''}.`,
    [row('Total utang', money(L.TotalDebt, cur)), row('Ekuitas', money(L.StockholdersEquity, cur)), row('Debt/Equity = utang ÷ ekuitas', pc(der, 0)), ic != null && row('Interest coverage = laba operasi ÷ beban bunga', xx(ic))].filter(Boolean),
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
    [row(`Free cash flow ${L.asOf}`, money(fcf, cur)), row('EBITDA', money(L.EBITDA, cur)), L.NetIncome != null && row('Kas bebas ÷ laba bersih', L.NetIncome ? pc((fcf / L.NetIncome) * 100, 0) : '–')].filter(Boolean),
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
    [row('Dividend yield', pc(v.dividendYieldPct)), row('Payout ratio (dividen ÷ laba)', pc(v.payoutRatioPct, 0)), row('Dividen 3 bulan terakhir', (fin.price?.dividends3m || []).map((d) => `${d.date}: ${nf(d.amount, 2)}`).join(', ') || '–')],
    'Payout >100% berarti dividen dibayar lebih besar dari laba periode itu.');
  return cards;
}

/* ---------- tab Keuangan ---------- */
function tabKeuangan() {
  const { financial: fin, financialError, company: c } = CS.data;
  if (c.type !== 'public') { $('#cbody').innerHTML = '<div class="empty"><b>Perusahaan tertutup</b>Tidak ada kewajiban publikasi laporan keuangan. Sinyal pendanaan, gugatan, PHK, dan pergantian direksi dipantau lewat berita.</div>'; return; }
  if (!fin) { $('#cbody').innerHTML = `<div class="empty"><b>Data keuangan tidak tersedia</b>${esc(financialError || '')}</div>`; return; }
  const v = fin.valuation, f = fin.fundamentals || { quarterly: [], annual: [] }, q = f.quarterly, an = f.annual;
  const cur = f.currency || fin.price?.currency || '', mc = fin.price?.currency || cur;
  const health = healthCards(fin, c);
  const cnt = { baik: 0, waspada: 0, buruk: 0 };
  health.forEach((h) => { if (cnt[h.status] != null) cnt[h.status]++; });

  const hl = (label, val, g, sub) => `<div><small>${label}</small><div class="v">${val}</div><div class="s">${chip(g)}${sub ? `<span>${sub}</span>` : ''}</div></div>`;
  const fy = (key) => (an[0]?.[key] != null ? `FY ${an[0].asOf.slice(0, 4)}: ${money(an[0][key], cur)}` : '');
  const old = [...q].reverse();
  const labels = old.map((x) => x.asOf.slice(0, 7));
  const rows = (list) => list.map((r) => `<tr><td>${esc(r.asOf)}</td><td>${money(r.TotalRevenue, cur)}</td><td>${money(r.GrossProfit, cur)}</td><td>${money(r.OperatingIncome, cur)}</td><td>${money(r.EBITDA, cur)}</td><td class="${r.NetIncome < 0 ? 'down' : ''}">${money(r.NetIncome, cur)}</td><td>${money(r.FreeCashFlow, cur)}</td><td>${money(r.CashAndCashEquivalents, cur)}</td><td>${money(r.TotalAssets, cur)}</td><td>${money(r.TotalDebt, cur)}</td><td>${money(r.StockholdersEquity, cur)}</td></tr>`).join('');
  const head = '<tr><th>Periode</th><th>Pendapatan</th><th>Laba kotor</th><th>Laba operasi</th><th>EBITDA</th><th>Laba bersih</th><th>Free cash flow</th><th>Kas</th><th>Total aset</th><th>Total utang</th><th>Ekuitas</th></tr>';
  const margin = (key, base = 'TotalRevenue') => old.map((x) => ratio(x[key], x[base]));
  const tile = (l, val) => `<div><small>${l}</small><div class="v" style="font-size:19px">${val}</div></div>`;

  $('#cbody').innerHTML = `
    <div class="row" style="margin-top:22px;justify-content:space-between">
      <h4 style="margin:0">Kesehatan keuangan <span class="muted sm">· kuartal ${esc(q[0]?.asOf || '-')}</span></h4>
      <span class="row" style="gap:6px"><span class="tag t-green">${cnt.baik} baik</span><span class="tag t-amber">${cnt.waspada} waspada</span><span class="tag t-red">${cnt.buruk} perlu perhatian</span></span>
    </div>
    <div class="health">${health.map((h) => `
      <details class="hc st-${h.status}"><summary>
        <div class="row" style="justify-content:space-between;gap:8px"><b>${esc(h.title)}</b><span class="tag ${ST[h.status][0]}">${ST[h.status][1]}</span></div>
        <div class="hh">${esc(h.headline)}</div>
        ${h.calc.length ? '<div class="more">Lihat perhitungan ▾</div>' : ''}</summary>
        ${h.calc.length ? `<div class="calc">${h.calc.map((r) => `<div class="kv"><span style="border:0">${esc(r.label)}</span><b>${esc(String(r.value))}</b></div>`).join('')}${h.note ? `<div class="sm dim" style="margin-top:8px">${esc(h.note)}</div>` : ''}</div>` : ''}
      </details>`).join('')}</div>
    ${fin.signals?.length ? `<div class="row" style="margin-top:12px">${fin.signals.map((s) => `<span class="tag ${s.level === 'baik' ? 't-green' : 't-red'}" style="white-space:normal;padding:6px 10px">${s.level === 'baik' ? '▲' : '▼'} ${esc(s.text)}</span>`).join('')}</div>` : ''}

    <h4>Angka utama <span class="muted sm">· kuartal terakhir (${esc(cur)}), dibanding periode yang sama tahun lalu</span></h4>
    <div class="hl">
      ${hl('Pendapatan', money(q[0]?.TotalRevenue, cur), growth(q, 'TotalRevenue'), fy('TotalRevenue'))}
      ${hl('Laba bersih', money(q[0]?.NetIncome, cur), growth(q, 'NetIncome'), fy('NetIncome'))}
      ${hl('EBITDA', money(q[0]?.EBITDA, cur), growth(q, 'EBITDA'), fy('EBITDA'))}
      ${hl('Free cash flow', money(q[0]?.FreeCashFlow, cur), growth(q, 'FreeCashFlow'), fy('FreeCashFlow'))}
      ${hl('Kas & setara kas', money(q[0]?.CashAndCashEquivalents, cur), growth(q, 'CashAndCashEquivalents'), '')}
      ${hl('Kapitalisasi pasar', money(v?.marketCap, mc), null, v?.per != null ? `PER ${nf(v.per, 1)}x · PBV ${nf(v.pbv, 2)}x` : '')}
    </div>

    <h4>Grafik</h4>
    <div class="charts">
      <div class="card"><div class="ct">Harga saham · 3 bulan</div>${priceChart(fin.price?.series)}</div>
      <div class="card"><div class="ct">Margin (% dari pendapatan)</div>${lineChart([{ name: 'Kotor', color: '#4c8dff', vals: margin('GrossProfit') }, { name: 'Operasi', color: '#fbbf24', vals: margin('OperatingIncome') }, { name: 'Bersih', color: '#2fbf71', vals: margin('NetIncome') }], labels)}</div>
      <div class="card"><div class="ct">Pendapatan per kuartal</div>${barChart(q, 'TotalRevenue')}</div>
      <div class="card"><div class="ct">Laba bersih per kuartal</div>${barChart(q, 'NetIncome')}</div>
      <div class="card"><div class="ct">EBITDA per kuartal</div>${barChart(q, 'EBITDA')}</div>
      <div class="card"><div class="ct">Free cash flow per kuartal</div>${barChart(q, 'FreeCashFlow')}</div>
    </div>

    ${v ? `<h4>Valuasi & imbal hasil</h4><div class="hl">${tile('PER', nf(v.per, 1) + 'x')}${tile('Forward PER', nf(v.forwardPer, 1) + 'x')}${tile('PBV', nf(v.pbv, 2) + 'x')}${tile('EPS', nf(v.eps, 2))}${tile('Dividend yield', v.dividendYieldPct == null ? '–' : nf(v.dividendYieldPct, 1) + '%')}${tile('Payout ratio', v.payoutRatioPct == null ? '–' : nf(v.payoutRatioPct, 1) + '%')}${tile('ROE', v.roePct == null ? '–' : nf(v.roePct, 1) + '%')}${tile('Beta', nf(v.beta, 2))}</div>` : ''}

    <h4>Rincian lengkap <span class="muted sm">· untuk menelusuri angka</span></h4>
    ${q.length ? `<details class="card tbl" open><summary>Laporan keuangan per kuartal</summary><div class="scroll"><table><thead>${head}</thead><tbody>${rows(q)}</tbody></table></div></details>
      <details class="card tbl"><summary>Laporan keuangan tahunan</summary><div class="scroll"><table><thead>${head}</thead><tbody>${rows(an)}</tbody></table></div></details>
      <details class="card tbl"><summary>Margin & rasio per kuartal</summary><div class="scroll"><table><thead><tr><th>Periode</th><th>Margin kotor</th><th>Margin operasi</th><th>Margin bersih</th><th>Margin EBITDA</th><th>Debt / Equity</th><th>Current ratio</th><th>Interest coverage</th></tr></thead>
        <tbody>${q.map((x) => `<tr><td>${esc(x.asOf)}</td><td>${pc(ratio(x.GrossProfit, x.TotalRevenue))}</td><td>${pc(ratio(x.OperatingIncome, x.TotalRevenue))}</td><td class="${x.NetIncome < 0 ? 'down' : ''}">${pc(ratio(x.NetIncome, x.TotalRevenue))}</td><td>${pc(ratio(x.EBITDA, x.TotalRevenue))}</td><td>${pc(ratio(x.TotalDebt, x.StockholdersEquity), 0)}</td><td>${xx(ratio(x.CurrentAssets, x.CurrentLiabilities, false))}</td><td>${xx(x.InterestExpense ? ratio(x.OperatingIncome, Math.abs(x.InterestExpense), false) : null)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
    ${fin.price?.dividends3m?.length ? `<details class="card tbl"><summary>Dividen (3 bulan terakhir)</summary>${fin.price.dividends3m.map((d) => `<div class="kv"><span>${esc(d.date)}</span><b>${nf(d.amount, 2)} ${esc(fin.price.currency)}</b></div>`).join('')}</details>` : ''}
    <details class="card tbl"><summary>Pengumuman bursa (IDX, 90 hari)</summary>
      ${fin.announcements?.length ? fin.announcements.map((a) => `<div class="kv"><span style="border:0;color:var(--text)">${a.url ? `<a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener" style="color:var(--cyan)">${esc(a.title)}</a>` : esc(a.title)}</span><b class="dim sm">${esc(a.date)}</b></div>`).join('')
        : `<div class="muted" style="padding:8px 0">${esc(fin.errors?.announcements || 'Tidak ada pengumuman.')}${fin.errors?.announcements ? ' — situs IDX kadang memblokir akses otomatis.' : ''}</div>`}</details>
    <div class="sm dim" style="margin-top:14px">Sumber: Yahoo Finance & IDX, per ${esc(new Date(fin.fetchedAt).toLocaleString('id-ID'))}. Kartu kesehatan dihitung dengan aturan tetap dari angka di bawahnya (tanpa AI); beberapa metrik tidak tersedia untuk sektor tertentu, mis. EBITDA untuk bank.</div>`;
}

/* ---------- Analisis AI ---------- */
const KONDISI = { positif: ['t-green', 'Positif'], negatif: ['t-red', 'Negatif'], campuran: ['t-amber', 'Campuran'], netral: ['t-gray', 'Netral'] };
function renderAnalysis(a) {
  const box = $('#aiBox');
  if (!box) return;
  const k = KONDISI[a.kondisi] || KONDISI.netral;
  const refLinks = (txt) => esc(txt).replace(/\[(\d+)\]/g, (m, n) => {
    const r = (a.refs || []).find((x) => x.n === Number(n));
    return r ? `<a class="ref" href="${esc(safeUrl(r.url))}" ${r.id ? 'data-nid="' + r.id + '"' : ''} target="_blank" rel="noopener" title="${esc((r.title || 'Berita') + '::' + [r.source, r.date ? String(r.date).slice(0, 10) : ''].filter(Boolean).join(' · ') + (r.id ? ' — klik untuk membuka beritanya.' : ''))}">${n}</a>` : m;
  });
  const list = (items, cls, sign) => (items?.length ? items.map((x) => `<div class="ai-pt"><span class="tag ${cls}">${sign}</span><div><b>${esc(x.poin)}</b><div class="sm muted">Dasar: ${refLinks(x.dasar)}${x.basis === 'tanpa_rujukan_berita' ? ' <span class="tag t-amber" title="Poin ini tidak merujuk ke berita mana pun (mis. hanya angka keuangan). Tidak bisa ditelusuri otomatis: periksa sendiri.">belum tertelusuri ke berita</span>' : ''}</div></div></div>`).join('') : '<div class="muted sm">Tidak ada.</div>');
  box.innerHTML = `<div class="card ai">
    <div class="row" style="justify-content:space-between"><div class="eyebrow" style="margin:0">ANALISIS AI</div>
      <span class="row" style="gap:8px">${a.rating_risiko ? '<span class="tag t-gray">Rating AI: ' + esc(String(a.rating_risiko).replace('_', ' ')) + '</span>' : ''}<span class="tag ${k[0]}">${k[1]}</span><span class="tag t-gray">Keyakinan ${esc(a.keyakinan)}</span>
      <button class="btn" id="aiRegen" style="padding:5px 10px">⟳ Buat ulang</button></span></div>
    <h2 style="font-size:20px;margin:12px 0 8px;letter-spacing:-.01em">${esc(a.headline)}</h2>
    <p style="color:#c5cbd3;line-height:1.7">${esc(a.ringkasan)}</p>
    ${a.temuan_deed?.length ? '<div class="ai-h" style="margin-top:14px;color:var(--cyan)">Temuan deed discovery (pengurus, pemegang saham, akta)</div>' + list(a.temuan_deed, 't-violet', '§') : ''}
    <div class="ai-cols"><div><div class="ai-h up">▲ Faktor positif</div>${list(a.faktor_positif, 't-green', '+')}</div>
      <div><div class="ai-h down">▼ Faktor risiko</div>${list(a.faktor_risiko, 't-red', '−')}</div></div>
    ${a.verifikasi?.length ? '<div class="ai-h" style="margin-top:14px">Yang perlu diverifikasi di FAP</div><ul style="padding-left:18px;color:#c5cbd3">' + a.verifikasi.map((v) => '<li>' + esc(v) + '</li>').join('') + '</ul>' : ''}
    ${a.outlook ? `<div class="ai-h" style="margin-top:14px">Outlook</div><p style="color:#c5cbd3">${esc(a.outlook)}</p>` : ''}
    ${a.pantau?.length ? `<div class="ai-h" style="margin-top:10px">Yang perlu dipantau</div><ul style="padding-left:18px;color:#c5cbd3">${a.pantau.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    <details style="margin-top:14px"><summary class="sm muted" style="cursor:pointer">Daftar berita yang dirujuk (${(a.refs || []).length})</summary><div class="sm dim" style="padding:6px 0 8px">Angka di “Dasar” (mis. <span class="ref">3</span>) adalah nomor berita pada daftar ini. Nomor dibuat per analisis: berita dengan bukti risiko terbesar lebih dulu, lalu berita terbaru. Nomornya berganti setiap analisis dibuat ulang. Klik angka atau judul untuk membuka beritanya.</div>
      ${(a.refs || []).map((r) => `<div class="kv"><span style="border:0"><span class="ref">${r.n}</span> <a href="${esc(safeUrl(r.url))}" ${r.id ? 'data-nid="' + r.id + '"' : ''} target="_blank" rel="noopener" style="color:var(--cyan)">${esc(r.title)}</a></span><b class="dim sm">${esc(r.source || '')}</b></div>`).join('')}</details>
    <div class="sm dim" style="margin-top:12px">Dibuat ${esc(a.generatedAt ? new Date(a.generatedAt).toLocaleString('id-ID') : '-')} oleh ${esc(a.model || 'AI')} dari ${a.newsCount} berita${a.hasFinancial ? ' + data keuangan' : ''}. Bantuan analisis dari data yang tersedia, bukan keputusan kredit; verifikasi ke dokumen sumber sebelum dipakai.</div></div>`;
  $('#aiRegen').onclick = () => runAnalysis($('#aiRegen'));
}
async function loadAnalysis() {
  const box = $('#aiBox');
  if (!box) return;
  const id = CS.data.company.id;
  try {
    const { analysis } = await api(`/api/company/${encodeURIComponent(id)}/ai-analysis`);
    if (analysis) return renderAnalysis(analysis);
  } catch { /* tampilkan tombol */ }
  box.innerHTML = `<div class="card ai"><div class="eyebrow">ANALISIS AI</div><div class="muted" style="margin-bottom:12px">Belum ada analisis AI untuk perusahaan ini. AI merangkum data keuangan dan berita 30 hari yang sudah tersimpan, lengkap dengan rujukan.</div><button class="btn pri" id="aiGo">✦ Buat analisis AI</button></div>`;
  $('#aiGo').onclick = () => runAnalysis($('#aiGo'));
}
async function runAnalysis(btn) {
  const id = CS.data.company.id, old = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Menganalisis…';
  try {
    const { analysis } = await api(`/api/company/${encodeURIComponent(id)}/ai-analysis`, { method: 'POST' });
    if (CS.data.company.id === id) renderAnalysis(analysis);
  } catch (e) { toast('Analisis AI gagal: ' + e.message, 8000); btn.disabled = false; btn.innerHTML = old; }
}
