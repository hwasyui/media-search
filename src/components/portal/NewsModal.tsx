'use client';
/* Modal detail berita (klik berita mana pun). Urutan: siapa/kapan -> apa artinya bagi debitur (ringkasan + dampak) -> isi berita -> temuan risiko
   beserta kutipan buktinya -> penilaian AI -> info sumber. Hal teknis (alat crawl, query, status data cleaned, ID) hanya ada di "Detail teknis". */
import Link from 'next/link';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '@/components/providers/AppProvider';
import { ago, artUrl, faviconUrl, fmtDT, safeUrl } from '@/lib/client/format';
import { IMP_DOT } from './NewsUi';

const NW_CAT: Record<string, string> = { hukum: 'Hukum & perkara', keuangan: 'Keuangan & pembayaran', integritas: 'Integritas & fraud', kepemilikan: 'Kepemilikan & pengurus', operasional: 'Operasional', regulasi: 'Regulasi & sanksi', reputasi: 'Reputasi' };
const NW_SEV: Record<number, string> = { 1: 'Ringan', 2: 'Rendah', 3: 'Sedang', 4: 'Tinggi', 5: 'Sangat tinggi' };
const NW_SRC: Record<string, string> = { google_news: 'Google News (RSS)', bing_news: 'Bing News (RSS)', youtube: 'YouTube', social_media: 'Media sosial (via Google)', local_index: 'Index lokal crawler' };
const NW_ROLE: Record<string, string> = { subjek: 'Subjek utama berita', pihak_terlibat: 'Pihak yang terlibat', disebut_sekilas: 'Hanya disebut sekilas', pihak_lain: 'Bukan perusahaan ini' };
const NW_ROLE_HINT: Record<string, string> = { subjek: 'Peristiwa utama berita ini tentang perusahaan.', pihak_terlibat: 'Perusahaan ikut terlibat, tetapi bukan fokus utama.', disebut_sekilas: 'Nama perusahaan hanya lewat; peristiwa utamanya tentang hal lain.', pihak_lain: 'Berita ini tentang pihak lain (mis. bernama mirip).' };
const NW_MOD: Record<string, string> = { none: 'Polos (nama saja)', isu: 'Isu / kabar', viral: 'Viral', kontroversi: 'Kontroversi', keluhan: 'Keluhan publik', rumor: 'Rumor' };
const NW_KIND: Record<string, string> = { resmi: 'Resmi', berita: 'Berita', persepsi_publik: 'Persepsi publik', konsumen: 'Konten konsumen (disaring)' };
const NW_PLAT: Record<string, string> = { berita: 'Media massa', blog: 'Blog & forum', sosmed: 'Media sosial', video: 'Video', resmi: 'Sumber resmi' };
const NW_TIER: Record<string, string> = { official: 'Sumber resmi (instansi/bursa)', mainstream: 'Media massa / situs berita umum', corporate: 'Situs perusahaan / komersial', aggregator: 'Agregator / non-redaksi', social_forum: 'Media sosial / forum' };
const NW_INFO: Record<string, string> = { fakta: 'Fakta', rumor: 'Rumor', opini: 'Opini / keluhan', tidak_jelas: 'Belum jelas' };
const NW_SENT: Record<string, string> = { positif: 'Positif', netral: 'Netral', negatif: 'Negatif' };
const yn = (v: any) => (v == null ? '–' : v ? 'Ya' : 'Tidak');

const AiMini = () => <span className="ai-mini" title="Dihasilkan oleh AI yang membaca isi artikel">✦ AI</span>;
const Row = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <div className="nw-r"><span>{label}{hint && <> <i title={hint}>?</i></>}</span><div>{children}</div></div>
);

// Hanya paragraf <p> berisi teks yang diterima; tag lain dibuang walau server (atau sumber lain) menulisnya.
function safeParagraphs(html: string | null | undefined): string[] {
  const out: string[] = [];
  const dec = (s: string) => new DOMParser().parseFromString(s, 'text/html').documentElement.textContent || '';
  String(html || '').replace(/<p>([\s\S]*?)<\/p>/g, (_m, t) => { const x = String(t).replace(/<[^>]*>/g, '').trim(); if (x) out.push(dec(x)); return ''; });
  return out;
}

// Apakah tautan artikel sudah terbukti bisa dibuka? Hanya "terbukti" bila sistem berhasil membuka artikelnya dan membaca isinya.
function linkStatus(d: any): ReactNode {
  const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return '–'; } };
  const google = /^https:\/\/news\.google\.com\//.test(d.url || '');
  if (d.article_url && d.content_html) return <><span className="tag t-green">Tautan bisa dibuka</span> sistem berhasil membuka artikel di {host(d.article_url)} dan membaca isinya.</>;
  if (d.article_url) return <><span className="tag t-amber">Alamat asli ditemukan</span> {host(d.article_url)}{d.link_error === 'isi_tidak_terbaca' || !d.content_html ? ', tetapi isinya belum berhasil dibaca (situs menolak akses, berbayar, atau tanpa teks).' : '.'}</>;
  if (google) return <><span className="tag t-amber">Belum dibuka</span> ini tautan pengalihan Google News. {d.link_error === 'decode_429' ? 'Alamat penerbit belum bisa dicari karena Google sedang membatasi permintaan; dicoba lagi saat Anda menekan "Baca artikel asli" atau lewat "Lengkapi data tersimpan".' : d.link_error === 'decode_gagal' ? 'Tautan ini tidak dapat didekode.' : 'Alamat penerbitnya dicari saat Anda menekan "Baca artikel asli".'}</>;
  return d.content_html ? <><span className="tag t-green">Tautan bisa dibuka</span> sistem berhasil membaca isinya.</> : <><span className="tag t-amber">Belum dibuka</span> isi artikel belum berhasil dibaca.</>;
}

// Tiga lapis data: MENTAH (semua hasil crawl) -> CLEANED (alamat penerbit valid, bukan konten konsumen) -> RELEVAN (dinilai AI relevan).
// Relevan juga mensyaratkan isi cukup panjang (berita 500 karakter, caption sosmed/video 80). Yang ditampilkan di aplikasi = cleaned yang relevan menurut AI, ditambah cleaned yang belum dinilai AI tetapi teksnya menyebut nama perusahaan (sementara).
function cleanedStatus(d: any): [string, string, string] {
  const addr = d.article_url || d.found_url || d.url || '';
  if (!d.article_url && /^https:\/\/(news\.google\.com|(www\.)?google\.com\/search)/i.test(addr)) return ['t-gray', 'Mentah (belum cleaned)', 'Alamat asli di situs penerbit belum ditemukan, jadi belum dikirim ke AI dan belum tampil di data cleaned.'];
  if (d.content_kind === 'konsumen') return ['t-gray', 'Mentah (disaring)', 'Disaring: AI menilai isinya konten tutorial/promo/lowongan konsumen.'];
  if (d.ai_status === 'ok') {
    if (d.relevant === 1 && !d.company_role) return ['t-amber', 'Cleaned, perlu dinilai ulang AI', 'AI (format penilaian lama) menandai berita ini relevan tetapi tanpa peran perusahaan, jadi belum masuk Relevan dan tidak dihitung dalam rating. Jalankan "Klasifikasi AI ulang" di Task Runner.'];
    if (d.relevant === 1 && d.stage === 1) return ['t-amber', 'Cleaned, isi terlalu pendek', 'AI menilai relevan, tetapi isi yang tersimpan kurang dari batas minimum (berita 500 karakter, caption sosmed/video 80 karakter), jadi belum masuk data relevan. Jalankan "Lengkapi data tersimpan" untuk mengambil isinya.'];
    return d.relevant === 1
      ? ['t-green', 'Relevan (dinilai AI)', 'Cleaned dan AI menilai berita ini relevan dengan perusahaan.']
      : ['t-gray', 'Cleaned, tidak relevan (AI)', 'AI menilai berita ini tidak relevan dengan perusahaan, jadi tidak tampil.'];
  }
  if (d.related === 1 && d.related_via === 'perusahaan') return ['t-amber', 'Cleaned, belum dinilai AI', 'Tampil sementara karena teksnya menyebut nama/alias perusahaan.'];
  return ['t-gray', 'Cleaned, belum dinilai AI', 'Belum dinilai AI dan teksnya tidak menyebut nama/alias perusahaan, jadi belum tampil.'];
}

function Detail({ d }: { d: any }) {
  const { layer, openNews } = useApp();
  const assessed = d.ai_status === 'ok' && !!d.company_role;
  const tags: any[] = Array.isArray(d.risk_tags) ? d.risk_tags : [];
  const paras = safeParagraphs(d.content_html);
  const textRef = useRef<HTMLDivElement>(null);
  const [clamp, setClamp] = useState(true);
  const [canExpand, setCanExpand] = useState(false);

  // "Baca selengkapnya" hanya bila isinya memang lebih panjang dari kotaknya
  useLayoutEffect(() => {
    const tx = textRef.current;
    if (tx && tx.scrollHeight > tx.clientHeight + 8) setCanExpand(true);
    else { setCanExpand(false); setClamp(false); }
  }, [d.id]);

  const sib: any[] = Array.isArray(d.kembar) ? d.kembar : [];
  const also: any[] = Array.isArray(d.juga_dimuat) ? d.juga_dimuat : [];
  const [stCls, stLabel, stWhy] = cleanedStatus(d);
  const adapterNames = (d.adapters || []).map((a: string) => NW_SRC[a] || a).join(' + ');
  const relTxt = d.related === 0 ? 'Teks belum menyebut perusahaan maupun pemangku kepentingannya'
    : d.related_via === 'perusahaan' ? 'Teks menyebut nama/alias perusahaan' : 'Teks menyebut pemangku kepentingan: ' + String(d.related_via || '').replace('stakeholder: ', '');
  const finalUrl = safeUrl(artUrl(d));
  const exact = Boolean(finalUrl) && finalUrl !== '#' && !finalUrl.startsWith('/go/');
  const cell = (k: string, v: ReactNode, hint?: string) => <div><small title={hint}>{k}</small><b>{v}</b></div>;

  return (
    <>
      {sib.length > 1 && (
        <div className="nw-tabs" role="tablist" title="Artikel yang sama relevan untuk beberapa perusahaan::Isi artikelnya sama, tetapi penilaian AI (peran, dampak, temuan risiko) dihitung per perusahaan. Pilih tab untuk melihat penilaian tiap perusahaan.">
          <span className="sm dim">Dinilai untuk:</span>
          {sib.map((c) => {
            const vis = layer === 'mentah' || (layer === 'cleaned' ? c.stage >= 1 : c.stage === 2);
            return (
              <button key={c.id} type="button" className={'nw-tab' + (c.id === d.id ? ' on' : '') + (vis ? '' : ' off')} role="tab" aria-selected={c.id === d.id} data-tab-nid={c.id}
                title={c.company_name + ' · dampak: ' + (c.impact || 'belum dinilai AI') + (vis ? '' : ' · belum masuk lapis yang dipilih untuk perusahaan ini')}
                onClick={() => { if (c.id !== d.id) openNews(c.id); }}>
                <i style={{ background: (c.impact && IMP_DOT[c.impact]) || 'transparent' }} />{c.label}
              </button>
            );
          })}
        </div>
      )}
      {d.image_url && <div className="nw-img"><img src={`/img/${d.id}`} alt="" referrerPolicy="no-referrer" onError={(e) => e.currentTarget.parentElement?.remove()} /></div>}

      <div className="nw-chips">
        {!assessed ? <span className="tag t-amber" title="AI belum membaca isi berita ini">Belum dinilai AI</span> : (
          <>
            {d.impact === 'buruk' ? <span className="tag t-red">▼ Risiko bagi debitur</span> : d.impact === 'baik' ? <span className="tag t-green">▲ Katalis positif</span> : <span className="tag t-gray">Netral</span>}
            {tags[0] && <span className={'tag ' + (tags[0].severity >= 4 ? 't-red' : tags[0].severity >= 3 ? 't-amber' : 't-gray')}>{NW_CAT[tags[0].cat] || tags[0].cat} · {tags[0].severity}/5</span>}
            {d.category === 'rumor' && <span className="tag t-amber">Rumor</span>}
          </>
        )}
        {d.credibility_tier === 'official' && <span className="tag t-green">✓ Sumber resmi</span>}
        {d.content_truncated && <span className="tag t-amber" title="Isi artikel yang tersimpan berhenti di tengah (kemungkinan dibatasi penerbit/paywall). Buka artikel asli untuk membaca lengkap.">Isi terpotong</span>}
        {also.length > 0 && <span className="tag t-cyan" title="Berita yang sama juga dimuat media lain (daftarnya di bagian bawah). Hanya satu yang disimpan sebagai berita.">Juga dimuat di {also.length} media</span>}
        {d.credibility_tier === 'corporate' ? <span className="tag t-gray" title="Situs/siaran pers perusahaan atau situs komersial: bukan pihak ketiga yang independen.">Situs perusahaan</span>
          : d.credibility_tier === 'aggregator' ? <span className="tag t-gray" title="Agregator/situs non-redaksi: periksa sumber aslinya.">Agregator</span> : null}
        {NW_PLAT[d.platform] && d.platform !== 'berita' && d.platform !== 'resmi' && <span className="tag t-cyan">{NW_PLAT[d.platform]}</span>}
      </div>

      {assessed ? (
        <div className="nw-sum"><div className="nw-sum-h"><AiMini /><b>Ringkasan</b></div>
          <div>{d.ai_summary ? d.ai_summary : <span className="muted">AI tidak membuat ringkasan.</span>}</div>
          {d.impact_reason && <div className="nw-why"><b>Dampak:</b> {d.impact_reason}</div>}
        </div>
      ) : (
        <div className="nw-sum pending"><div className="nw-sum-h"><b>Belum dinilai AI</b></div>
          <div className="muted">Dampak dan risiko berita ini belum tersedia. Jalankan “Klasifikasi AI ulang” di Task Runner, atau tekan <b>Tanya AI</b> di atas untuk meminta penjelasan.</div></div>
      )}

      <div className="nw-sec"><h5>Isi berita</h5>
        {paras.length > 0 ? (
          <>
            <div className={'nw-text' + (clamp ? ' clamp' : '')} id="nwText" ref={textRef}>{paras.map((p, i) => <p key={i}>{p}</p>)}</div>
            {d.content_truncated && <div className="muted sm" style={{ marginTop: 6 }}>⚠ Isi artikel tampak terpotong (kemungkinan dibatasi penerbit). Klik “Baca artikel asli” untuk versi lengkapnya.</div>}
            <button type="button" className="nw-more" id="nwMore" hidden={!canExpand} onClick={() => setClamp((c) => !c)}>{clamp ? 'Baca selengkapnya ▾' : 'Ringkas ▴'}</button>
          </>
        ) : d.snippet ? (
          <><div className="nw-text"><p>{d.snippet}</p></div><div className="sm dim" style={{ marginTop: 6 }}>Hanya cuplikan. Isi lengkap belum diambil; buka artikel asli untuk membacanya.</div></>
        ) : <div className="muted sm">Tidak ada isi yang tersimpan. Buka artikel asli untuk membacanya.</div>}
      </div>

      {tags.length > 0 ? (
        <div className="nw-sec"><h5>Temuan risiko <AiMini /></h5>
          {tags.map((t, i) => (
            <div className="nw-find" key={i}>
              <div><b>{NW_CAT[t.cat] || t.cat}</b>
                <div className="nw-sev" title={`Tingkat ${t.severity} dari 5 (${NW_SEV[t.severity] || ''})`}>
                  {[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= t.severity ? 'on s' + Math.min(t.severity, 5) : ''} />)}
                  <span>{NW_SEV[t.severity] || ''} · {t.severity}/5</span>
                </div>
              </div>
              <blockquote>“{t.hit}”</blockquote>
            </div>
          ))}
          <div className="sm dim">Kutipan di atas diperiksa sistem: hanya yang benar-benar ada di teks artikel yang ditampilkan.</div>
        </div>
      ) : assessed ? <div className="nw-sec"><h5>Temuan risiko <AiMini /></h5><div className="muted sm">AI tidak menemukan temuan risiko pembiayaan pada berita ini.</div></div> : null}

      {assessed && (
        <div className="nw-sec"><h5>Penilaian AI <AiMini /></h5>
          <div className="nw-grid">
            {cell('Peran perusahaan', NW_ROLE[d.company_role] || '–', NW_ROLE_HINT[d.company_role])}
            {cell('Jenis informasi', NW_INFO[d.category] || d.category || '–')}
            {cell('Sentimen', NW_SENT[d.sentiment] || d.sentiment || '–')}
            {cell('Keyakinan AI', d.confidence == null ? '–' : d.confidence + '%', 'Seberapa yakin AI pada penilaiannya (0–100%)')}
          </div>
          {d.reason && <div className="nw-why" style={{ marginTop: 10 }}><b>Inti bahasan:</b> {d.reason}</div>}
          <div className="sm dim" style={{ marginTop: 8 }}>Dibuat AI dari isi artikel ini, belum diaudit manusia. Anggap sebagai petunjuk apa yang perlu diverifikasi, bukan keputusan kredit.</div>
        </div>
      )}

      <div className="nw-sec"><h5>Tentang sumber</h5>
        <div className="nw-grid">
          {cell('Penerbit', d.source_name || d.source_domain || '–')}
          {cell('Jenis sumber', NW_TIER[d.credibility_tier] || '–', 'Dinilai dari domain situs dengan aturan tetap (bukan AI)')}
          {cell('Skor kredibilitas', d.credibility_score == null ? '–' : d.credibility_score + ' / 100', 'Aturan tetap berdasarkan domain; mengukur jenis sumber, bukan kebenaran isi berita ini')}
        </div>
      </div>

      {also.length > 0 && (
        <div className="nw-sec"><h5>Juga dimuat di {also.length} media lain</h5>
          <div className="sm dim" style={{ marginBottom: 8 }}>Berita yang sama (judul sama atau mirip) dari penerbit lain. Hanya satu yang disimpan sebagai berita supaya tidak dihitung ganda; yang lain dicatat di sini.</div>
          {also.map((e, i) => {
            const ok = /^https?:\/\//i.test(e.url || '');
            return (
              <div className="nw-also" key={i}>
                <div>{ok ? <a className="nw-lnk" href={e.url} target="_blank" rel="noopener">{e.domain || e.url}</a> : <b>{e.domain || '–'}</b>}
                  {' '}<span className="tag t-gray">{NW_TIER[e.tier] || 'jenis sumber tidak tercatat'}{e.score != null ? ' · ' + e.score : ''}</span>
                  {e.at && <> <span className="sm muted">terlihat {fmtDT(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(e.at) ? e.at.replace(' ', 'T') + 'Z' : e.at)}</span></>}</div>
                {e.title && <div className="sm muted">“{e.title}”</div>}
              </div>
            );
          })}
        </div>
      )}

      <details className="nw-tech"><summary>Detail teknis</summary>
        <div className="nw-kv">
          <Row label="Status data cleaned"><span className={'tag ' + stCls}>{stLabel}</span> <span className="sm muted">{stWhy}</span></Row>
          <Row label="Keterkaitan nama">{relTxt}</Row>
          <Row label="Relevan menurut AI">{yn(d.relevant)}</Row>
          <Row label="Diambil oleh"><b>{adapterNames}</b>{d.adapters_inferred && <> <span className="muted sm">(diperkirakan dari bentuk tautan)</span></>}</Row>
          <div className="nw-lbl">Query yang menemukannya</div>
          {Array.isArray(d.found_via) && d.found_via.length ? d.found_via.map((v: any, i: number) => (
            <div className="nw-q" key={i}><b>{NW_SRC[v.src] || v.src || 'sumber tidak tercatat'}</b>{v.q && <div className="mono">{v.q}</div>}
              <div className="sm muted">kata kunci: {v.keyword || '–'} · modifier: {NW_MOD[v.modifier] || v.modifier || '–'}</div></div>
          )) : <div className="muted sm">Jejak query tidak tercatat. Kata kunci yang cocok: <b>{d.keyword || '–'}</b></div>}
          <Row label="Sinyal risiko (AI)">{Array.isArray(d.risk_signals) && d.risk_signals.length
            ? d.risk_signals.map((x: any, i: number) => <span key={i}><span className="tag t-gray">{typeof x === 'string' ? x : JSON.stringify(x)}</span>{' '}</span>) : <span className="muted">tidak ada</span>}</Row>
          <Row label="Topik (AI)">{d.topic || '–'}</Row>
          <Row label="Terlihat di crawl">{(d.seen_count || 1) + ' kali · pertama ' + fmtDT(d.fetched_at) + (d.last_seen_at ? ' · terakhir ' + fmtDT(d.last_seen_at) : '')}</Row>
          <Row label="Platform / jenis">{(NW_PLAT[d.platform] || d.platform) + ' / ' + (NW_KIND[d.content_kind] || d.content_kind)}</Row>
          <Row label="Status AI">{d.ai_status}{d.ai_error && <> <span className="mono">{d.ai_error}</span></>}</Row>
          <Row label="Status tautan">{linkStatus(d)}</Row>
          <Row label="ID berita">{d.id}</Row>
          <Row label="Tautan artikel">{exact ? <a className="mono nw-lnk" href={finalUrl} target="_blank" rel="noopener">{finalUrl.startsWith('/go/') ? (d.article_url || d.url) : finalUrl}</a> : <span className="muted">alamat penerbit belum diketahui</span>}</Row>
          <Row label="Gambar">{d.image_url ? (/^https?:\/\//i.test(d.image_url) ? <a className="mono nw-lnk" href={d.image_url} target="_blank" rel="noopener">{d.image_url}</a> : <span className="mono">{d.image_url}</span>) : '–'}</Row>
        </div>
      </details>
    </>
  );
}

export default function NewsModal() {
  const { api, newsId, closeNews, setNewsTitle, toast } = useApp();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (newsId == null) { setD(null); setErr(null); return; }
    let alive = true;
    setD(null); setErr(null);
    api('/api/news/' + encodeURIComponent(String(newsId)))
      .then((x) => { if (alive) { setD(x); setNewsTitle(x.title || ''); if (bodyRef.current) bodyRef.current.scrollTop = 0; } })
      .catch((e: Error) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [newsId, api, setNewsTitle]);

  useEffect(() => {
    if (newsId == null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeNews(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [newsId, closeNews]);

  const finalUrl = d ? safeUrl(artUrl(d)) : '#';
  const exact = Boolean(d) && Boolean(finalUrl) && finalUrl !== '#' && !finalUrl.startsWith('/go/');
  const openTip = exact ? 'Buka artikel asli di situs penerbit' : 'Alamat penerbit asli belum tersedia';

  function copyLink() {
    const u = exact ? finalUrl : (d?.article_url || '');
    if (!u || /^https:\/\/www\.google\.com\/search\?/i.test(u) || u === '#' || u.startsWith('/go/')) return toast('Alamat artikel penerbit belum tersedia.', 4000);
    if (/^https:\/\/news\.google\.com\//.test(u)) return toast('Alamat penerbit belum diketahui.', 4000);
    navigator.clipboard?.writeText(u).then(() => toast('Tautan disalin.'), () => toast('Gagal menyalin tautan.'));
  }

  return (
    <div className="modal-ov" id="nwModal" hidden={newsId == null} onClick={(e) => { if ((e.target as HTMLElement).id === 'nwModal') closeNews(); }}>
      <div className="modal-box nw-box">
        <div className="nw-head">
          <div className="nw-hd-main">
            <div className="nw-meta" id="nwMeta">
              {d && (
                <>
                  {d.source_domain && <img src={faviconUrl(d.source_domain)} width={16} height={16} alt="" referrerPolicy="no-referrer" onError={(e) => e.currentTarget.remove()} />}
                  <b>{d.source_name || d.source_domain || 'Sumber'}</b><span>·</span>
                  <span title={fmtDT(d.published_at)}>{fmtDT(d.published_at)} ({ago(d.published_at)})</span><span>·</span>
                  <Link prefetch={false} className="co-pill" href={`/c/${encodeURIComponent(d.company_id)}`} onClick={closeNews}>{d.company_ticker || d.company_name}</Link>
                </>
              )}
            </div>
            <h3 id="nwTitle">
              {err ? 'Gagal memuat' : !d ? 'Memuat…'
                : exact ? <a className="nw-tl" href={finalUrl} target="_blank" rel="noopener" title={openTip}>{d.title}</a>
                : <span className="nw-tl" title={openTip}>{d.title}</span>}
            </h3>
          </div>
          <div className="nw-hd-act">
            <button type="button" className="ai-btn" id="nwAskTop" title="Buka asisten AI untuk berita ini" onClick={() => window.dispatchEvent(new Event('ms-assistant-open'))}>
              <svg viewBox="0 0 32 32" width="16" height="16" fill="#fff" aria-hidden="true"><path d="M13 3c1 7.5 4.5 11 12 12-7.500 1-11 4.500-12 12-1-7.500-4.500-11-12-12 7.500-1 11-4.500 12-12z" /><path d="M25 3c.4 3 1.800 4.400 4.800 4.800-3 .4-4.400 1.800-4.800 4.800-.4-3-1.800-4.400-4.800-4.800 3-.4 4.400-1.800 4.800-4.800z" /></svg>Tanya AI
            </button>
            <button type="button" className="nw-x" id="nwClose" aria-label="Tutup" onClick={closeNews}>✕</button>
          </div>
        </div>
        <div id="nwBody" ref={bodyRef}>
          {err ? <div className="empty"><b>Gagal memuat detail</b>{err}</div>
            : !d ? <div className="muted" style={{ padding: '20px 0' }}>Memuat detail berita…</div>
            : <Detail d={d} />}
        </div>
        <div className="nw-foot">
          <button type="button" className="btn" id="nwCopy" onClick={copyLink}>Salin tautan</button>
          <a className={'btn wht' + (exact ? '' : ' disabled')} id="nwOpen" target="_blank" rel="noopener" href={exact ? finalUrl : undefined} title={openTip}>{exact ? 'Baca artikel asli ↗' : 'Alamat asli belum tersedia'}</a>
        </div>
      </div>
    </div>
  );
}
