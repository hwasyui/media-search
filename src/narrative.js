// Narasi analisis singkat berbasis ATURAN (template), bukan AI: angka dari data keuangan + hitungan sinyal berita.
// Setiap kalimat hanya muncul bila datanya ada, jadi tidak pernah mengarang.
const fmt = (n, d = 1) => Number(n).toLocaleString('id-ID', { maximumFractionDigits: d });
const abs = (n) => Math.abs(n);
const dir = (n) => (n > 0 ? 'naik' : 'turun');

export function buildNarrative({ company, financial, stats }) {
  const tk = company.ticker || company.name;
  const p = financial?.price;
  const q = financial?.fundamentals?.quarterly || [];
  const sentences = [];
  let headline = `${company.name}: belum ada cukup data untuk disimpulkan.`;
  let tone = 'netral';

  if (p) {
    const m1 = p.change1mPct, d5 = p.change5dPct;
    if (m1 != null && m1 <= -10) { headline = `${tk} tertekan, belum terlihat tanda pulih.`; tone = 'buruk'; }
    else if (m1 != null && m1 >= 10) { headline = `${tk} menguat dalam sebulan terakhir.`; tone = 'baik'; }
    else if (d5 != null && abs(d5) >= 5) { headline = `${tk} ${dir(d5)} cukup tajam dalam sepekan.`; tone = d5 < 0 ? 'buruk' : 'baik'; }
    else headline = `${tk} bergerak relatif stabil.`;
    if (p.dayChangePct != null) sentences.push(`Hari ini harga ${tk} ${dir(p.dayChangePct)} ${fmt(abs(p.dayChangePct), 2)}%${m1 != null ? `, dan dalam sebulan terakhir ${dir(m1)} ${fmt(abs(m1))}%` : ''}.`);
    if (p.price && p.low52w && p.high52w) {
      const pos = Math.round(((p.price - p.low52w) / (p.high52w - p.low52w)) * 100);
      sentences.push(`Harga berada di ${pos}% dari rentang 52 minggu (${fmt(p.low52w, 0)}–${fmt(p.high52w, 0)}).`);
    }
  }
  if (q[0]) {
    const yoy = q.find((x) => x.asOf.slice(5) === q[0].asOf.slice(5) && x.asOf.slice(0, 4) === String(Number(q[0].asOf.slice(0, 4)) - 1));
    if (q[0].NetIncome != null && yoy?.NetIncome > 0) {
      const ch = ((q[0].NetIncome - yoy.NetIncome) / yoy.NetIncome) * 100;
      sentences.push(`Laba bersih kuartal ${q[0].asOf} ${dir(ch)} ${fmt(abs(ch))}% dibanding periode yang sama tahun lalu.`);
      if (ch <= -20 && tone === 'netral') tone = 'buruk';
    } else if (q[0].NetIncome != null && q[0].NetIncome < 0) {
      sentences.push(`Perusahaan membukukan rugi bersih pada kuartal ${q[0].asOf}.`);
      tone = 'buruk';
    }
  }
  const v = financial?.valuation;
  if (v?.per != null && v?.pbv != null) sentences.push(`Valuasi saat ini PER ${fmt(v.per)}x dan PBV ${fmt(v.pbv, 2)}x${v.dividendYieldPct ? `, dividend yield ${fmt(v.dividendYieldPct)}%` : ''}.`);

  if (stats?.total) {
    const parts = [`${stats.total} berita/sinyal dalam 30 hari terakhir`];
    if (stats.risk) parts.push(`${stats.risk} bernada risiko`);
    if (stats.positive) parts.push(`${stats.positive} katalis positif`);
    if (stats.rumor) parts.push(`${stats.rumor} masih berupa rumor/belum terverifikasi`);
    sentences.push(`Dari pemantauan media: ${parts.join(', ')}.`);
  } else if (!p) {
    sentences.push('Belum ada berita tersimpan. Tekan "Perbarui berita" untuk mengambil data terbaru.');
  }
  const watch = [];
  if (financial?.signals?.length) for (const s of financial.signals.slice(0, 3)) watch.push({ level: s.level, text: s.text });
  return { headline, tone, body: sentences, watch };
}
