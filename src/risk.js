// Risiko pembiayaan berbasis ATURAN (tanpa AI), supaya hasilnya konsisten dan bisa diaudit di proses FAP.
//  1) riskTags(teks): tag risiko per berita (kategori + tingkat 1-5 + kata yang cocok)
//  2) buildRiskProfile(): skor per kategori + skor total + rating, dengan daftar faktor beserta bukti (berita/angka)
//  3) CHECKLIST: langkah verifikasi dokumen/pihak untuk tiap temuan
// Ini indikator awal dari informasi publik, BUKAN keputusan kredit; hasilnya wajib diverifikasi ke dokumen sumber.

export const CATEGORIES = {
  hukum: { label: 'Hukum & Perkara', hint: 'gugatan, PKPU/pailit, wanprestasi, proses pidana' },
  keuangan: { label: 'Keuangan & Pembayaran', hint: 'gagal bayar, restrukturisasi utang, rugi, likuiditas' },
  integritas: { label: 'Integritas & Fraud', hint: 'korupsi, penipuan, pencucian uang, penggelapan' },
  kepemilikan: { label: 'Kepemilikan & Pengurus (deed)', hint: 'pergantian direksi/pemegang saham, akuisisi, perubahan akta' },
  operasional: { label: 'Operasional', hint: 'PHK, mogok, kecelakaan, penghentian operasi, izin' },
  regulasi: { label: 'Regulasi & Sanksi', hint: 'sanksi, denda, pencabutan/pembekuan izin, daftar hitam' },
  reputasi: { label: 'Reputasi', hint: 'kontroversi, viral negatif, boikot' },
};

// [kategori, tingkat 1-5, regex]. Satu berita boleh punya beberapa kategori; tiap kategori diambil tingkat tertingginya.
const RULES = [
  ['hukum', 5, /\b(pailit|dipailitkan|pkpu|penundaan kewajiban pembayaran utang)\b/i],
  ['hukum', 4, /\b(tersangka|terdakwa|ditahan|dipidana|vonis|divonis|dakwaan|penyidikan|ditangkap)\b/i],
  ['hukum', 3, /\b(gugatan|digugat|menggugat|wanprestasi|sengketa|somasi|perkara|litigasi|pengadilan|sita|penyitaan|eksekusi jaminan)\b/i],
  ['keuangan', 5, /\b(gagal bayar|default|kredit macet|wanprestasi utang|going concern|gagal membayar)\b/i],
  ['keuangan', 4, /\b(restrukturisasi utang|restrukturisasi kredit|tunggakan|menunggak|kesulitan likuiditas|arus kas negatif|utang menumpuk|krisis keuangan)\b/i],
  ['keuangan', 3, /\b(rugi|merugi|kerugian|laba (anjlok|turun|merosot)|pendapatan (anjlok|turun|merosot)|beban bunga|utang jatuh tempo)\b/i],
  ['integritas', 5, /\b(korupsi|suap|gratifikasi|pencucian uang|tppu|penipuan|penggelapan|pemalsuan|fraud|manipulasi laporan)\b/i],
  ['integritas', 3, /\b(dugaan (penyimpangan|pelanggaran|penyelewengan)|investigasi|diperiksa|dipanggil kpk|kejaksaan)\b/i],
  ['kepemilikan', 3, /\b(pemegang saham baru|perubahan (pengendali|kepemilikan|akta|susunan pengurus)|akta perubahan|pengalihan saham|divestasi|diakuisisi|akuisisi|dijual ke|penjualan saham)\b/i],
  ['kepemilikan', 2, /\b(pergantian|rombak|reshuffle|mengundurkan diri|mundur|dicopot|direktur utama baru|direksi baru|komisaris baru|rups|rupslb|merger|penggabungan|spin-?off)\b/i],
  ['operasional', 4, /\b(penghentian operasi|dihentikan operasinya|izin (usaha )?dicabut|tambang (ditutup|disegel)|disegel|force majeure|pabrik (ditutup|tutup)|berhenti beroperasi)\b/i],
  ['operasional', 3, /\b(phk|pemutusan hubungan kerja|mogok|demo buruh|unjuk rasa|kecelakaan|ledakan|kebakaran|longsor|gangguan produksi|penghentian sementara)\b/i],
  ['regulasi', 4, /\b(sanksi|dibekukan|diblokir|blacklist|daftar hitam|dicabut izin|pencabutan izin|ditutup paksa)\b/i],
  ['regulasi', 4, /\b(izin\b.{0,30}\bdicabut|dicabut\b.{0,12}\bizin|pencabutan\b.{0,12}\bizin)\b/i],
  ['operasional', 4, /\b(operasional(nya)?\s+(dihentikan|ditutup|disetop)|(dihentikan|ditutup|disetop)\s+operasional)\b/i],
  ['regulasi', 3, /\b(denda|pelanggaran|dilarang|teguran|peringatan tertulis|suspensi|ppatk)\b/i],
  ['reputasi', 2, /\b(boikot|skandal|kontroversi|viral|dikritik|protes|dikecam|keluhan)\b/i],
];

// Berita yang menyangkut PIHAK LAIN (mis. peringatan penipuan untuk nasabah, edukasi, korban, pelanggar/SPBU nakal yang disanksi perusahaan,
// sanksi terhadap negara lain) bukan temuan tentang perusahaannya.
// Tag integritas/hukum/keuangan dibuang untuk pola ini; tag lain tetap dinilai.
const THIRD_PARTY = /\b(hati-?hati|waspada|awas|kenali|modus|mengatasnamakan|berkedok|berkedok|palsu|korban (penipuan|pencurian)|tips|cara (menghindari|mengatasi|melapor)|jangan (tergiur|percaya)|iming-?iming|phishing|scam|rekrutmen (palsu|fiktif)|lowongan (palsu|fiktif)|edukasi)\b|\b(pelanggar|spbu nakal|agen nakal|pangkalan nakal|oknum|mafia|pengecer|penyalahgunaan subsidi)\b|\bsanksi\b.{0,35}\b(rusia|iran|korea utara|venezuela|myanmar|ukraina|amerika|as|eropa)\b/i;
const THIRD_PARTY_CATS = new Set(['integritas', 'hukum', 'keuangan', 'regulasi']);

export function riskTags(text) {
  const best = new Map();
  const thirdParty = THIRD_PARTY.test(text || '');
  for (const [cat, sev, re] of RULES) {
    const m = re.exec(text || '');
    if (m && thirdParty && THIRD_PARTY_CATS.has(cat)) continue;
    if (m && (!best.has(cat) || sev > best.get(cat).severity)) best.set(cat, { cat, severity: sev, hit: m[0].toLowerCase() });
  }
  return [...best.values()].sort((a, b) => b.severity - a.severity);
}
export const maxSeverity = (tags) => tags.reduce((m, t) => Math.max(m, t.severity), 0);

// ─── Profil risiko perusahaan ──────────────────────────
const CRED_W = { official: 1.2, mainstream: 1.0, social_forum: 0.5 };
const recencyW = (days) => (days <= 7 ? 1 : days <= 30 ? 0.8 : days <= 90 ? 0.5 : 0.3);
const MAX_ITEMS_PER_CAT = 4;      // banyak artikel untuk satu peristiwa tidak boleh menggelembungkan skor
const saturate = (x, k) => Math.round(100 * (1 - Math.exp(-x / k)));
const CAT_K = 12, TOTAL_K = 28;   // makin besar = makin lambat menjenuh
// Penilaian AI atas berita: negatif terhadap perusahaan = bobot penuh; netral = kecil; positif = tidak dihitung; belum dinilai AI = setengah.
// 'kepemilikan' (deed) tidak otomatis buruk (mis. perusahaan mengakuisisi pihak lain), jadi bobotnya selalu kecil dan dilaporkan sebagai temuan.
function aiWeight(n, cat) {
  if (cat === 'kepemilikan') return 0.35;
  if (n.ai_status !== 'ok') return 0.5;
  const s = String(n.sentiment || '').toLowerCase();
  if (s.startsWith('neg')) return 1;
  if (s.startsWith('pos')) return 0;
  return 0.4;
}

export const RATINGS = [
  { max: 20, key: 'rendah', label: 'Rendah' },
  { max: 45, key: 'sedang', label: 'Sedang' },
  { max: 70, key: 'tinggi', label: 'Tinggi' },
  { max: 101, key: 'sangat_tinggi', label: 'Sangat tinggi' },
];
export const ratingOf = (score) => RATINGS.find((r) => score < r.max);

// Sinyal keuangan (emiten) yang ikut dihitung ke kategori "keuangan"
function financialFactors(fin, company) {
  if (!fin) return [];
  const out = [];
  const q = fin.fundamentals?.quarterly || [];
  const L = q[0] || {};
  const isBank = /bank|perbankan/i.test(`${company.sector} ${company.name}`);
  const add = (points, text) => out.push({ cat: 'keuangan', points, text, source: 'Data keuangan' });
  if (L.NetIncome != null && L.NetIncome < 0) add(6, `Rugi bersih pada kuartal ${L.asOf}.`);
  const yoy = q.find((x) => x.asOf.slice(5) === L.asOf?.slice(5) && Number(x.asOf.slice(0, 4)) === Number(L.asOf?.slice(0, 4)) - 1);
  if (yoy && L.NetIncome != null && yoy.NetIncome > 0) {
    const ch = ((L.NetIncome - yoy.NetIncome) / yoy.NetIncome) * 100;
    if (ch <= -20) add(3, `Laba bersih turun ${Math.abs(Math.round(ch))}% dibanding periode yang sama tahun lalu.`);
  }
  if (!isBank && L.StockholdersEquity > 0 && L.TotalDebt != null) {
    const der = (L.TotalDebt / L.StockholdersEquity) * 100;
    if (der > 200) add(4, `Utang ${Math.round(der)}% dari ekuitas (DER tinggi).`);
  }
  if (L.StockholdersEquity != null && L.StockholdersEquity < 0) add(6, 'Ekuitas negatif.');
  if (!isBank && L.CurrentAssets && L.CurrentLiabilities) {
    const cr = L.CurrentAssets / L.CurrentLiabilities;
    if (cr < 1) add(3, `Current ratio ${cr.toFixed(2)}x (aset lancar < liabilitas jangka pendek).`);
  }
  if (!isBank && L.InterestExpense && L.OperatingIncome != null) {
    const ic = L.OperatingIncome / Math.abs(L.InterestExpense);
    if (ic < 1.5) add(4, `Laba operasi hanya menutup beban bunga ${ic.toFixed(1)}x.`);
  }
  if (L.FreeCashFlow != null && L.FreeCashFlow < 0) add(2, 'Free cash flow negatif.');
  const p = fin.price;
  if (p?.change1mPct != null && p.change1mPct <= -20) add(2, `Harga saham turun ${Math.abs(p.change1mPct)}% dalam sebulan.`);
  return out;
}

// Langkah verifikasi per kategori temuan (aturan tetap)
export const CHECKLIST = {
  hukum: ['Cek perkara perdata/pidana debitur dan pengurus di SIPP pengadilan setempat.', 'Minta klarifikasi tertulis debitur atas perkara yang ditemukan dan status terakhirnya.', 'Pastikan aset yang akan dijaminkan tidak sedang menjadi objek sengketa/sita.'],
  keuangan: ['Minta laporan keuangan audit terbaru dan rekening koran 6-12 bulan.', 'Lakukan pengecekan SLIK OJK debitur dan pengurus.', 'Hitung ulang kemampuan bayar (DSCR) dengan kewajiban yang sudah ada.'],
  integritas: ['Periksa daftar sanksi/DPO dan rekam jejak pengurus; eskalasi ke fungsi compliance/APU-PPT.', 'Telusuri sumber berita resmi (putusan, siaran aparat) sebelum menyimpulkan.'],
  kepemilikan: ['Bandingkan susunan pengurus dan pemegang saham di berita dengan akta terakhir dan SK Kemenkumham (AHU).', 'Pastikan perubahan akta/pengendali yang diberitakan sudah tercatat di AHU dan dokumen FAP.', 'Periksa pihak afiliasi/pengendali baru (beneficial owner).'],
  operasional: ['Konfirmasi kondisi operasional lokasi proyek/tambang dan status izin usaha (NIB, IUP, dll.).', 'Nilai dampak penghentian/gangguan terhadap arus kas dan penggunaan unit yang dibiayai.'],
  regulasi: ['Periksa status sanksi/izin di situs regulator terkait (OJK, kementerian, instansi sektor).', 'Minta bukti pemenuhan sanksi atau pencabutan sanksi dari debitur.'],
  reputasi: ['Verifikasi kebenaran isu lewat sumber primer; berita media sosial/rumor belum bisa dijadikan dasar keputusan.'],
};

// news: [{id,title,url,source_name,published_at,credibility_tier,category,risk_tags,risk_level}]
export function buildRiskProfile({ company, financial, news }) {
  const now = Date.now();
  // Nama yang dipakai mengenali perusahaan di judul berita (nama tanpa PT/Tbk + alias). Berita yang tidak menyebutnya di judul
  // bobotnya setengah: bisa menyangkut pihak lain atau hanya terkait tidak langsung.
  const names = [company.name.replace(/\b(pt|tbk|persero|\(persero\))\b/gi, ' ').replace(/\s+/g, ' ').trim(), ...(company.aliases || [])].map((x) => String(x).toLowerCase()).filter((x) => x.length >= 3);
  const mentions = (title) => names.some((x) => String(title).toLowerCase().includes(x));
  const cats = Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, { items: [], sum: 0 }]));
  for (const n of news) {
    const tags = typeof n.risk_tags === 'string' ? JSON.parse(n.risk_tags) : n.risk_tags || [];
    const days = Math.max(0, (now - new Date(n.published_at).getTime()) / 86400000);
    const w = (CRED_W[n.credibility_tier] ?? 1) * (n.category === 'rumor' ? 0.6 : 1) * recencyW(days);
    for (const t of tags) {
      const direct = mentions(n.title);
      const pts = t.severity * w * aiWeight(n, t.cat) * (direct ? 1 : 0.5);
      if (pts <= 0) continue;
      cats[t.cat]?.items.push({
        points: pts, direct, sentiment: n.sentiment, aiOk: n.ai_status === 'ok', severity: t.severity, hit: t.hit, rumor: n.category === 'rumor', tier: n.credibility_tier,
        title: n.title, url: n.url, source: n.source_name, date: n.published_at, id: n.id,
      });
    }
  }
  const fin = financialFactors(financial, company);
  for (const f of fin) cats[f.cat].items.push({ ...f, finance: true });

  let total = 0;
  const categories = {};
  const factors = [];
  for (const [k, c] of Object.entries(cats)) {
    c.items.sort((a, b) => b.points - a.points);
    const used = c.items.slice(0, MAX_ITEMS_PER_CAT);
    const sum = used.reduce((s, x) => s + x.points, 0);
    total += sum;
    categories[k] = { label: CATEGORIES[k].label, score: saturate(sum, CAT_K), count: c.items.length, topSeverity: Math.max(0, ...c.items.map((x) => x.severity || 0)) };
    for (const x of used) factors.push({ category: k, ...x });
  }
  const score = saturate(total, TOTAL_K);
  // Tanpa berita dan tanpa data keuangan, "skor 0" bukan berarti aman: tandai sebagai data belum cukup.
  const noData = !news.length && !financial;
  const rating = noData ? { key: 'tidak_cukup_data', label: 'Data belum cukup' } : ratingOf(score);
  const checklist = Object.entries(categories)
    .filter(([, c]) => c.count > 0 && c.score >= 15)
    .sort((a, b) => b[1].score - a[1].score)
    .map(([k]) => ({ category: k, label: CATEGORIES[k].label, steps: CHECKLIST[k] }));
  const caveats = [];
  if (!news.length) caveats.push('Belum ada berita tersimpan untuk perusahaan ini; rating hanya mencerminkan data yang ada. Jalankan crawl terlebih dulu.');
  if (company.type !== 'public') caveats.push('Perusahaan tertutup: tidak ada laporan keuangan publik. Rating hanya dari berita; wajib melengkapi dengan dokumen keuangan debitur.');
  if (!(company.stakeholders || []).length) caveats.push('Belum ada data pengurus/pemegang saham. Tambahkan dari akta agar pencarian berita mencakup nama mereka (deed discovery).');
  caveats.push('Indikator awal dari informasi publik berbasis aturan; bukan keputusan kredit dan bisa mengandung berita yang menyangkut pihak lain bernama mirip.');
  return {
    score, rating: rating.key, ratingLabel: rating.label, categories,
    factors: factors.sort((a, b) => b.points - a.points), checklist, caveats,
    coverage: { newsItems: news.length, hasFinancial: Boolean(financial), tagged: news.filter((n) => (n.risk_level || 0) > 0).length },
    method: 'Poin berita = tingkat tag (1-5) × bobot kredibilitas (resmi 1,2; media 1,0; medsos 0,5) × bobot kebaruan (≤7h 1,0; ≤30h 0,8; ≤90h 0,5) × 0,6 bila rumor × 0,5 bila judul tidak menyebut nama perusahaan × bobot penilaian AI (negatif 1; netral 0,4; belum dinilai 0,5; positif tidak dihitung; kepemilikan selalu 0,35). Berita peringatan/penipuan yang menyangkut pihak lain dibuang. Maksimal 4 bukti per kategori. Skor kategori = 100·(1−e^(−Σpoin/12)); skor total = 100·(1−e^(−Σ/28)). Rating: <20 Rendah, <45 Sedang, <70 Tinggi, selebihnya Sangat tinggi.',
  };
}
