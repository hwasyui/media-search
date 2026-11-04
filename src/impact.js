// Analisis dampak Good/Bad/Neutral — DETERMINISTIK (non-AI), kamus kata kunci katalis vs risiko.
// Konsep sama seperti "Analisis Dampak (Impact): Polarity Keyword Scoring NON-AI" di sistem referensi:
// bandingkan kemunculan kata kunci katalis positif vs risiko negatif, lalu susun argumen lewat template
// (bukan generative text) — zero-cost, instan, dan hasilnya konsisten tiap kali dijalankan ulang.
//
// Risiko negatif diprioritaskan di atas katalis positif kalau dua-duanya kebetulan muncul di teks yang sama,
// karena untuk kebutuhan due-diligence/monitoring risiko, sinyal buruk lebih penting untuk tidak terlewat.

const NEGATIVE = [
  [/\bsanksi (ojk|bei|regulator|administratif)\b|\bdenda ojk\b/i, 'sanksi regulasi',
    'Sanksi regulator dapat menekan kepercayaan investor dan mitra bisnis.'],
  [/\bkorupsi\b|\bsuap\b|\bgratifikasi\b|\bpenggelapan\b/i, 'dugaan korupsi',
    'Dugaan pelanggaran hukum berisiko besar terhadap reputasi dan kepercayaan pemangku kepentingan.'],
  [/\bgagal bayar\b|\bdefault\b|\bwanprestasi\b/i, 'gagal bayar',
    'Indikasi gagal bayar menekan persepsi kesehatan keuangan entitas.'],
  [/\banjlok\b|\bambruk\b|\bterjun bebas\b|turun (tajam|drastis|paling dalam)/i, 'penurunan tajam',
    'Penurunan tajam teridentifikasi, berpotensi menekan psikologis pelaku pasar.'],
  [/\barb\b|auto reject bawah/i, 'ARB',
    'Auto Reject Bawah mengindikasikan tekanan jual yang signifikan.'],
  [/\bdowngrade\b|penurunan peringkat|penurunan rating/i, 'downgrade peringkat',
    'Penurunan peringkat/rating dapat meningkatkan biaya modal dan menekan sentimen pasar.'],
  [/phk massal|pemutusan hubungan kerja massal/i, 'PHK massal',
    'PHK massal berisiko menimbulkan sorotan publik dan gangguan operasional.'],
  [/\bgugatan\b|sengketa hukum|\bdigugat\b|\bsomasi\b/i, 'sengketa hukum',
    'Sengketa hukum menambah ketidakpastian dan potensi beban finansial.'],
  [/\bpenyelidikan\b|diperiksa (kpk|kejaksaan|polisi|bareskrim)/i, 'penyelidikan aparat',
    'Penyelidikan oleh aparat penegak hukum berisiko terhadap reputasi entitas.'],
  [/\bpailit\b|\bbangkrut\b|kebangkrutan/i, 'kebangkrutan',
    'Indikasi kepailitan/kebangkrutan merupakan risiko eksistensial bagi entitas.'],
  [/\bkecewa\b|\bprotes\b|\bdemo\b|\bboikot\b/i, 'keluhan publik',
    'Sentimen negatif publik berpotensi berdampak pada citra entitas.'],
];

const POSITIVE = [
  [/laba (bersih )?naik|laba melonjak|untung naik/i, 'laba naik',
    'Pertumbuhan laba mengindikasikan kinerja keuangan yang membaik.'],
  [/pendapatan naik|penjualan naik|omzet naik/i, 'pendapatan naik',
    'Peningkatan pendapatan menunjukkan permintaan yang menguat.'],
  [/\bbuyback\b|beli kembali saham/i, 'buyback',
    'Aksi buyback umumnya dibaca pasar sebagai sinyal keyakinan manajemen.'],
  [/dividen (naik|jumbo|spesial)/i, 'dividen besar',
    'Pembagian dividen besar berpotensi menarik minat investor.'],
  [/\bekspansi\b|\bakuisisi\b|perluasan bisnis/i, 'ekspansi bisnis',
    'Ekspansi/akuisisi dapat membuka peluang pertumbuhan baru.'],
  [/\brebound\b|\bpulih\b|\bmenguat\b|\bmelesat\b/i, 'rebound',
    'Pemulihan/penguatan berpotensi memperbaiki sentimen pasar.'],
  [/penghargaan|\baward\b|peringkat (teratas|terbaik)/i, 'penghargaan',
    'Pengakuan/penghargaan berpotensi memperkuat reputasi dan kepercayaan publik.'],
  [/kontrak (baru|besar)|proyek (baru|besar)/i, 'kontrak baru',
    'Perolehan kontrak baru berpotensi menambah pendapatan ke depan.'],
  [/oversubscribed|kelebihan permintaan/i, 'oversubscribed',
    'Minat tinggi investor menandakan sentimen positif terhadap entitas.'],
];

export function impactOf(text) {
  const t = String(text || '');
  for (const [re, label, reason] of NEGATIVE) if (re.test(t)) return { impact: 'buruk', impact_reason: reason, matched: label };
  for (const [re, label, reason] of POSITIVE) if (re.test(t)) return { impact: 'baik', impact_reason: reason, matched: label };
  return { impact: 'netral', impact_reason: '', matched: null };
}
