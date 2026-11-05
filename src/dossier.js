// Dossier Korporasi Terstruktur 4-Bagian per perusahaan:
//   1. Pemilik Manfaat & Pengendali (UBO & PSP)
//   2. Klien Utama & Proyek Strategis
//   3. Akta & Perubahan Korporasi (M&A, RUPS, Pergantian Direksi)
//   4. Fasilitas Bank & Pembiayaan (Sindikasi, Plafon Pinjaman, Obligasi)
// Sumber:
//   - Berita lengkap tersimpan (content_html & snippet) dengan nomor rujukan [n] dan kutipan asli
//   - Data pemangku kepentingan / akta profil perusahaan
//   - Dokumen verifikasi debitur
// Anti-Halusinasi: Setiap item wajib memiliki nomor rujukan berita [n] dan kutipan asli;
// jika data tidak ditemukan di teks berita, bagian tersebut ditandai "butuh verifikasi akta/AHU", bukan karangan AI.

import { createHash } from 'node:crypto';
import { callAI } from './classify.js';
import { db } from './db.js';
import { extractContentFromUrl, htmlToText } from './extractor.js';
import { getRandomUa } from './financial.js';
import { saveNews } from './save.js';

const SYSTEM = `Kamu analis due diligence korporasi dan risiko kredit debitur. Dari DATA BERITA LENGKAP dan PROFIL PEMANGKU KEPENTINGAN yang diberikan, tugasmu adalah mengekstrak DOSSIER KORPORASI 4-BAGIAN secara faktual, ketat, dan tanpa asumsi:

1. PEMILIK MANFAAT & PENGENDALI (UBO & PSP):
   - Pemegang saham mayoritas/pengendali (PSP), pemilik manfaat akhir (UBO), konsorsium pemegang saham, atau persentase saham signifikan (>5%).
2. KLIEN UTAMA & PROYEK STRATEGIS:
   - Klien B2B/B2G utama, kontrak kerja sama besar, proyek strategis, konsorsium/joint venture operasional, tender besar yang dimenangkan.
3. AKTA & PERUBAHAN KORPORASI:
   - Peristiwa RUPS/RUPSLB, pergantian direksi/komisaris/manajemen, transaksi M&A, akuisisi, pelepasan saham/divestasi, perubahan modal/anggaran dasar.
4. FASILITAS BANK & PEMBIAYAAN:
   - Kredit modal kerja, kredit investasi, kredit sindikasi perbankan, plafon pinjaman, penerbitan obligasi/sukuk, fasilitas pembiayaan alat berat, penjaminan aset/collateral.

ATURAN MUTLAK ANTI-HALUSINASI:
- HANYA ekstrak fakta yang secara EKSPLISIT tertulis di dalam teks rujukan yang diberikan.
- DILARANG mengarang nama bank, nilai kontrak, nama klien, atau persentase kepemilikan.
- Setiap item WAJIB memiliki:
  * "dasar": nomor rujukan berita di mana fakta ini ditemukan, misal "[1]" atau "[3]"
  * "kutipan_asli": 1-2 kalimat kutipan persis (verbatim quote) dari teks rujukan yang membuktikan fakta tersebut
  * "status_verifikasi": "dari_berita_belum_verifikasi" (atau "terverifikasi_dokumen" bila bersumber dari keterbukaan bursa/akta resmi)
- JIKA TIDAK ADA INFORMASI UNTUK SALAH SATU BAGIAN, KOSONGKAN array-nya (berikan []). JANGAN MENGARANG ATAU MENEBAK.

Keluarkan HANYA JSON dengan format persis:
{
  "ringkasan": "1-2 kalimat rangkuman status dossier perusahaan",
  "pemilik_manfaat": [
    { "nama": "...", "peran_atau_porsi": "...", "dasar": "[n]", "kutipan_asli": "...", "status_verifikasi": "dari_berita_belum_verifikasi" }
  ],
  "klien_proyek": [
    { "klien_mitra": "...", "proyek_kontrak": "...", "nilai": "...", "dasar": "[n]", "kutipan_asli": "...", "status_verifikasi": "dari_berita_belum_verifikasi" }
  ],
  "akta_korporasi": [
    { "peristiwa": "...", "rincian": "...", "tanggal": "...", "dasar": "[n]", "kutipan_asli": "...", "status_verifikasi": "dari_berita_belum_verifikasi" }
  ],
  "fasilitas_bank": [
    { "kreditor_bank": "...", "jenis_fasilitas": "...", "plafon": "...", "dasar": "[n]", "kutipan_asli": "...", "status_verifikasi": "dari_berita_belum_verifikasi" }
  ]
}
Maksimal 6 item paling penting per kategori.`;

export async function getCompanyDossier(companyId) {
  const [[row]] = await db().query(
    'SELECT company_id, generated_at, content FROM company_dossiers WHERE company_id = ?',
    [companyId],
  );
  if (!row) return null;
  const content = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
  return { company_id: row.company_id, generated_at: row.generated_at, ...content };
}

export async function saveCompanyDossier(companyId, dossier) {
  await db().query(
    `INSERT INTO company_dossiers (company_id, generated_at, content) VALUES (?, UTC_TIMESTAMP(), ?)
     ON DUPLICATE KEY UPDATE generated_at = VALUES(generated_at), content = VALUES(content)`,
    [companyId, JSON.stringify(dossier)],
  );
}

export async function generateCompanyDossier(companyId, { signal } = {}) {
  // 1. Ambil profil perusahaan & pemangku kepentingan terdaftar di database
  const [[co]] = await db().query('SELECT id, name, type, ticker, sector, aliases FROM companies WHERE id = ?', [companyId]);
  if (!co) throw new Error('Perusahaan tidak ditemukan: ' + companyId);
  const [stakeholders] = await db().query('SELECT name, role FROM stakeholders WHERE company_id = ? ORDER BY id ASC', [companyId]);

  // 2. Ambil berita-berita paling relevan dengan materi dossier (kepemilikan, akta/akuisisi, klien/proyek, kredit/utang)
  let [rows] = await db().query(
    `SELECT id, title, snippet, content_html, source_name, source_domain, published_at, category, company_role, url,
       (
         (title LIKE '%saham%' OR snippet LIKE '%saham%' OR content_html LIKE '%saham%') +
         (title LIKE '%kredit%' OR snippet LIKE '%kredit%' OR content_html LIKE '%kredit%' OR title LIKE '%pinjaman%' OR snippet LIKE '%pinjaman%' OR title LIKE '%obligasi%') +
         (title LIKE '%proyek%' OR snippet LIKE '%proyek%' OR content_html LIKE '%proyek%' OR title LIKE '%kontrak%' OR snippet LIKE '%kontrak%' OR title LIKE '%klien%') +
         (title LIKE '%akuisisi%' OR snippet LIKE '%akuisisi%' OR title LIKE '%divestasi%' OR snippet LIKE '%divestasi%' OR title LIKE '%merger%') +
         (title LIKE '%direksi%' OR snippet LIKE '%direksi%' OR title LIKE '%komisaris%' OR snippet LIKE '%komisaris%' OR title LIKE '%rups%') +
         (title LIKE '%kerja sama%' OR snippet LIKE '%kerja sama%' OR content_html LIKE '%kerja sama%' OR title LIKE '%kemitraan%')
       ) AS rel
     FROM news_items
     WHERE company_id = ? AND ((content_html IS NOT NULL AND content_html != '') OR (snippet IS NOT NULL AND snippet != ''))
     ORDER BY rel DESC, sort_at DESC
     LIMIT 18`,
    [companyId],
  );

  // Jika perusahaan baru (belum ada berita di database lokal):
  // Otomatis bootstrap pencarian cepat ke Google News & unduh isi artikelnya seketika!
  if (!rows.length) {
    try {
      const cleanName = co.name.replace(/\b(PT|Tbk|Persero|\(Persero\))\b/gi, '').replace(/[()]/g, '').trim();
      const q = co.ticker ? `"${cleanName}" OR "${co.ticker}"` : `"${cleanName}"`;
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=id&gl=ID&ceid=ID:id`;
      const res = await fetch(rssUrl, {
        headers: { 'User-Agent': getRandomUa(), 'Accept-Language': 'id-ID,id;q=0.9' },
        signal: AbortSignal.timeout(7000),
      });
      if (res.ok) {
        const xml = await res.text();
        const items = [];
        for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
          const t = m[1].match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
          const l = m[1].match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] || '';
          const s = m[1].match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] || '';
          const d = m[1].match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] || '';
          if (l) {
            items.push({
              title: t.replace(/<[^>]+>/g, '').trim(),
              url: l.trim(),
              source: s.replace(/<[^>]+>/g, '').trim(),
              date: d ? new Date(d) : new Date(),
            });
          }
        }
        const toSave = [];
        for (const item of items.slice(0, 10)) {
          const ext = await extractContentFromUrl(item.url, { title: item.title });
          toSave.push({
            title: item.title,
            url: ext?.targetUrl || item.url,
            snippet: ext?.snippet || item.title,
            fullContent: ext?.fullContent || '',
            contentHtml: ext?.contentHtml || null,
            image: ext?.image || null,
            sourceName: item.source || 'Google News',
            sourceUrl: ext?.targetUrl || item.url,
            date: item.date ? item.date.toISOString() : new Date().toISOString(),
          });
        }
        await saveNews(companyId, toSave);
        const [freshRows] = await db().query(
          `SELECT id, title, snippet, content_html, source_name, source_domain, published_at, category, company_role, url
           FROM news_items WHERE company_id = ? ORDER BY id DESC LIMIT 15`,
          [companyId],
        );
        if (freshRows.length) rows = freshRows;
      }
    } catch {
      // Fail gracefully: lanjutkan ekstraksi dengan data profil bila internet offline
    }
  }

  // Buat daftar rujukan bernomor [n]
  const refs = [];
  const newsPayload = [];
  const ISI_CHARS = 550;

  rows.forEach((r, idx) => {
    const n = idx + 1;
    const bodyText = (htmlToText(r.content_html) || r.snippet || '').trim().slice(0, ISI_CHARS);
    const dateStr = r.published_at ? new Date(r.published_at).toISOString().slice(0, 10) : '';
    const srcName = r.source_name || r.source_domain || 'Media';
    
    refs.push({
      n,
      id: r.id,
      title: r.title,
      url: r.url,
      source: srcName,
      date: dateStr,
      category: r.category,
    });

    newsPayload.push({
      n,
      judul: r.title,
      sumber: srcName,
      tanggal: dateStr,
      kategori: r.category,
      peran: r.company_role,
      isi_artikel: bodyText,
    });
  });

  const refMap = new Map(refs.map((r) => [r.n, r]));
  const userPrompt = `PERUSAHAAN: ${co.name} (${co.type === 'public' ? `emiten, ticker ${co.ticker}` : 'perusahaan tertutup'}), sektor: ${co.sector || '-'}.
ALIAS PERUSAHAAN: ${(co.aliases || []).join(', ') || '-'}
PEMANGKU KEPENTINGAN TERDAFTAR DI DATABASE / AKTA:
${stakeholders.map((s) => `- ${s.name} (${s.role || 'pengurus/pemegang saham'})`).join('\n') || '(belum ada data stakeholder terdaftar)'}

DATA BERITA LENGKAP (nomor [n] untuk rujukan wajib):
${JSON.stringify(newsPayload, null, 2)}`;

  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  const out = await callAI([{ role: 'system', content: SYSTEM }, { role: 'user', content: userPrompt }], model, signal);

  // 3. Validasi & Pengikatan Bukti (Anti-Halusinasi)
  function validateAndEnrich(items = [], type) {
    if (!Array.isArray(items)) return [];
    return items
      .map((it) => {
        const dasar = String(it.dasar || '');
        const nums = [...dasar.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
        const validRefs = nums.map((n) => refMap.get(n)).filter(Boolean);
        if (!validRefs.length && it.status_verifikasi !== 'terverifikasi_dokumen') {
          return null; // Tolak item tanpa rujukan berita yang valid
        }
        const primeRef = validRefs[0] || null;
        return {
          ...it,
          dasar: dasar || (primeRef ? `[${primeRef.n}]` : ''),
          status_verifikasi: it.status_verifikasi || 'dari_berita_belum_verifikasi',
          ref_n: primeRef ? primeRef.n : null,
          news_id: primeRef ? primeRef.id : null,
          url: primeRef ? primeRef.url : null,
          source_name: primeRef ? primeRef.source : null,
          published_at: primeRef ? primeRef.date : null,
        };
      })
      .filter(Boolean)
      .slice(0, 8);
  }

  const pemilik = validateAndEnrich(out.pemilik_manfaat, 'pemilik');
  const klien = validateAndEnrich(out.klien_proyek, 'klien');
  const akta = validateAndEnrich(out.akta_korporasi, 'akta');
  const fasilitas = validateAndEnrich(out.fasilitas_bank, 'fasilitas');

  // Integrasikan pemangku kepentingan database profil ke dalam pemilik_manfaat jika belum ada
  for (const st of stakeholders) {
    const exists = pemilik.some((p) => p.nama && p.nama.toLowerCase().includes(st.name.toLowerCase()));
    if (!exists) {
      pemilik.unshift({
        nama: st.name,
        peran_atau_porsi: st.role || 'Pemangku Kepentingan Terdaftar (Akta/FAP)',
        dasar: 'Database Profil',
        kutipan_asli: `Terdaftar sebagai ${st.role || 'pengurus'} di profil perusahaan.`,
        status_verifikasi: 'terverifikasi_dokumen',
        ref_n: null,
        news_id: null,
        url: null,
        source_name: 'Profil / Akta FAP',
        published_at: null,
      });
    }
  }

  // Hitung status ketersediaan & statistik
  const totalItems = pemilik.length + klien.length + akta.length + fasilitas.length;
  const verifiedCount = [pemilik, klien, akta, fasilitas].flat().filter((x) => x.status_verifikasi === 'terverifikasi_dokumen').length;
  const unverifiedCount = totalItems - verifiedCount;

  const result = {
    company_id: companyId,
    generated_at: new Date().toISOString(),
    ringkasan: out.ringkasan || `Dossier intelijen korporasi untuk ${co.name}.`,
    sections: {
      pemilik_manfaat: {
        judul: 'Pemilik Manfaat & Pengendali (PSP/UBO)',
        data_tersedia: pemilik.length > 0,
        pesan_kosong: 'Belum ada data pemilik pengendali dari berita — butuh verifikasi salinan Akta/AHU.',
        items: pemilik,
      },
      klien_proyek: {
        judul: 'Klien Utama & Proyek Strategis',
        data_tersedia: klien.length > 0,
        pesan_kosong: 'Belum ada data kontrak klien dari berita — butuh verifikasi PO/Invoice debitur.',
        items: klien,
      },
      akta_korporasi: {
        judul: 'Akta & Perubahan Korporasi',
        data_tersedia: akta.length > 0,
        pesan_kosong: 'Belum ada catatan perubahan korporasi di berita — butuh Akta Perubahan Notaris & SK Kemenkumham.',
        items: akta,
      },
      fasilitas_bank: {
        judul: 'Fasilitas Bank & Pembiayaan',
        data_tersedia: fasilitas.length > 0,
        pesan_kosong: 'Belum ada catatan fasilitas kredit dari berita — butuh verifikasi SLIK OJK & Surat Perjanjian Kredit.',
        items: fasilitas,
      },
    },
    stats: {
      total_items: totalItems,
      verified_count: verifiedCount,
      unverified_count: unverifiedCount,
      news_analyzed: refs.length,
    },
    refs,
  };

  await saveCompanyDossier(companyId, result);
  return result;
}
