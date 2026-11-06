'use client';
// Potongan tampilan berita yang dipakai di banyak tempat: tag, thumbnail, pil perusahaan, kartu berita, kartu utama, baris samping.
import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';
import { ago, artUrl, faviconUrl, fullDate, safeUrl } from '@/lib/client/format';
import { requestImage } from '@/lib/client/lazy-images';
import type { NewsRow } from '@/lib/client/types';

export const RISKCAT_LBL: Record<string, string> = { hukum: 'Hukum', keuangan: 'Keuangan', integritas: 'Integritas', kepemilikan: 'Kepemilikan', operasional: 'Operasional', regulasi: 'Regulasi', reputasi: 'Reputasi' };
const PLAT_SHORT: Record<string, string> = { video: 'Video', sosmed: 'Media sosial', blog: 'Blog & forum' };
const IMP_DOT: Record<string, string> = { buruk: 'var(--red,#ef5b5b)', baik: 'var(--green,#2fbf71)', netral: 'var(--dim,#8a93a0)' };
const ROLE_TXT: Record<string, string> = { subjek: 'subjek utama', pihak_terlibat: 'ikut terlibat', disebut_sekilas: 'hanya disebut sekilas', pihak_lain: 'pihak lain' };
export { IMP_DOT };

/** Belum dinilai AI dengan format baru = belum punya dampak/tag risiko yang bisa dipercaya (tidak ditebak dari kata kunci). */
export const isPending = (r: NewsRow) => r.ai_status !== 'ok' || !r.company_role;

/** Tag ringkas sebuah berita. compact=true: hanya yang terpenting (dampak / belum dinilai), untuk baris ringkas. */
export function Tags({ r, compact = false }: { r: NewsRow; compact?: boolean }) {
  const t: ReactNode[] = [];
  if (isPending(r)) {
    t.push(<span key="p" className="tag t-gray" title="Belum dinilai AI::AI belum membaca isi berita ini, jadi dampak dan risikonya belum tersedia dan berita ini belum dihitung dalam rating risiko. Jalankan “Klasifikasi AI ulang” di Task Runner.">Belum dinilai AI</span>);
  } else {
    if (r.impact === 'buruk') t.push(<span key="i" className="tag t-red" title={'Risiko bagi debitur::' + (r.impact_reason || 'AI menilai isi berita ini dapat merugikan kemampuan bayar atau reputasi debitur.')}>▼ Risiko</span>);
    else if (r.impact === 'baik') t.push(<span key="i" className="tag t-green" title={'Katalis positif::' + (r.impact_reason || 'AI menilai isi berita ini dapat menguatkan kemampuan bayar atau reputasi debitur.')}>▲ Katalis positif</span>);
    const top = Array.isArray(r.risk_tags) ? r.risk_tags[0] : null;
    if (top && !compact) {
      t.push(<span key="r" className={'tag ' + (top.severity >= 4 ? 't-red' : top.severity >= 3 ? 't-amber' : 't-gray')}
        title={'Temuan risiko: ' + (RISKCAT_LBL[top.cat] || top.cat) + '::Tingkat ' + top.severity + ' dari 5 (1 ringan, 3 sedang, 5 sangat tinggi). Kutipan dari artikel: “' + (top.hit || '-') + '”'}>{RISKCAT_LBL[top.cat] || top.cat} · {top.severity}/5</span>);
    }
  }
  if (compact) return <>{t}</>;
  if (r.credibility_tier === 'official') t.push(<span key="o" className="tag t-green" title="Sumber resmi::Berasal dari domain instansi pemerintah, bursa, atau lembaga resmi. Ini menunjukkan jenis sumbernya, bukan jaminan semua isinya benar.">✓ Sumber resmi</span>);
  if ((r.also_n ?? 0) > 0) t.push(<span key="a" className="tag t-gray" title={'Juga dimuat di media lain::Berita yang sama (judul sama atau mirip) juga dimuat ' + r.also_n + ' media lain. Daftarnya ada di detail berita.'}>+{r.also_n} media</span>);
  if (r.platform && PLAT_SHORT[r.platform]) t.push(<span key="pl" className="tag t-cyan">{PLAT_SHORT[r.platform]}</span>);
  if (r.content_kind === 'konsumen') t.push(<span key="k" className="tag t-gray" title="Konten konsumen::AI menilai isinya tutorial, promo, atau lowongan yang tidak berguna untuk menilai risiko kredit, jadi disaring dari daftar.">konten konsumen</span>);
  if (r.related === 0) t.push(<span key="t" className="tag t-gray" title="Tidak terkait::Teks berita belum menyebut perusahaan ini maupun pemangku kepentingannya.">tidak terkait</span>);
  return <>{t}</>;
}

/** Gambar sampul: dari cache lokal /img/:id. Berita tanpa gambar yang belum pernah dicek memintanya saat tampil (dibatch di server). */
function useCover(r: NewsRow): [boolean, () => void] {
  const [show, setShow] = useState(Boolean(r.image_url));
  useEffect(() => {
    setShow(Boolean(r.image_url));
    if (!r.image_url && !r.image_checked) {
      let alive = true;
      requestImage(r.id).then((ok) => { if (alive && ok) setShow(true); });
      return () => { alive = false; };
    }
  }, [r.id, r.image_url, r.image_checked]);
  return [show, () => setShow(false)];
}

function Favicon({ domain, size, className, style }: { domain?: string; size: number; className?: string; style?: React.CSSProperties }) {
  const [ok, setOk] = useState(true);
  if (!domain || !ok) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={faviconUrl(domain, size)} alt="" width={size === 32 ? 14 : undefined} height={size === 32 ? 14 : undefined} referrerPolicy="no-referrer" style={style} onError={() => setOk(false)} />;
}

/** Placeholder (logo + nama penerbit) selalu ada di bawah gambar: kalau gambar belum ada atau gagal dimuat, kartu tetap rapi dan seragam. */
export function Thumb({ r, big }: { r: NewsRow; big?: boolean }) {
  const [cover, drop] = useCover(r);
  const dom = r.source_domain;
  return (
    <div className={'thumb' + (big ? ' big' : '')}>
      <div className="ph">
        {dom && <PhIcon domain={dom} />}
        <span>{r.source_name || dom || 'sumber'}</span>
      </div>
      {cover && /* eslint-disable-next-line @next/next/no-img-element */ <img className="cover" src={`/img/${r.id}`} alt="" loading="lazy" referrerPolicy="no-referrer" onError={drop} />}
    </div>
  );
}
function PhIcon({ domain }: { domain: string }) {
  const [ok, setOk] = useState(true);
  // eslint-disable-next-line @next/next/no-img-element
  return ok ? <img src={faviconUrl(domain, 64)} alt="" referrerPolicy="no-referrer" onError={() => setOk(false)} /> : null;
}

/** Nama sumber + favicon penerbit (kecil, sejajar teks), bukan kotak besar. */
export function SrcTag({ r }: { r: NewsRow }) {
  const dom = r.source_domain;
  return (
    <span className="tag t-gray">
      <Favicon domain={dom} size={32} style={{ marginRight: 6 }} />
      {r.source_name || dom || r.source_key || 'sumber'}
    </span>
  );
}

/** Satu kartu untuk satu artikel: pil perusahaan utama + perusahaan lain yang punya artikel yang sama (penilaian AI-nya bisa berbeda: titik berwarna = dampak untuk perusahaan itu). */
export function CoPills({ r, full = true }: { r: NewsRow; full?: boolean }) {
  const more = Array.isArray(r.also_cos) ? r.also_cos : [];
  return (
    <>
      <Link prefetch={false} className="co-pill" href={`/c/${encodeURIComponent(r.company_id)}`}>🏢 {full ? r.company_name : (r.company_ticker || r.company_name)}</Link>
      {more.length > 0 && (
        <span className="co-more" title="Artikel yang sama juga relevan untuk perusahaan ini. Penilaian AI dihitung per perusahaan, jadi klik untuk melihat penilaiannya.">
          {more.slice().sort((a, b) => String(a.l).localeCompare(String(b.l))).map((c) => (
            <Link prefetch={false} key={c.id} className="co-chip" href={`/c/${encodeURIComponent(c.id)}`}
              title={c.l + ' · dampak: ' + (c.i || 'belum dinilai AI') + (c.r ? ' · peran: ' + (ROLE_TXT[c.r] || c.r) : '')}>
              <i style={{ background: (c.i && IMP_DOT[c.i]) || 'transparent', border: '1px solid ' + ((c.i && IMP_DOT[c.i]) || 'var(--dim,#8a93a0)') }} />{c.l}
            </Link>
          ))}
        </span>
      )}
    </>
  );
}

export function NewsCard({ r, showCompany = true }: { r: NewsRow; showCompany?: boolean }) {
  const sum = r.ai_summary || r.snippet;
  const href = safeUrl(artUrl(r));
  return (
    <article className="news" data-nid={r.id}>
      <Thumb r={r} />
      <div className="news-top"><SrcTag r={r} /><span className="dim sm" title={fullDate(r.published_at)}>{ago(r.published_at)}</span></div>
      <h3><a href={href} data-nid={r.id} target="_blank" rel="noopener" title="Klik untuk detail">{r.title}</a></h3>
      {sum ? <p>{sum}</p> : null}
      <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}><Tags r={r} /></div>
      <div className="meta">{showCompany ? <span className="co-wrap"><CoPills r={r} /></span> : <span></span>}<a href={href} target="_blank" rel="noopener">Sumber ↗</a></div>
    </article>
  );
}

export function LeadCard({ r }: { r: NewsRow }) {
  const sum = r.ai_summary || r.snippet;
  const href = safeUrl(artUrl(r));
  return (
    <article className="lead-main" data-nid={r.id}>
      <Thumb r={r} big />
      <div className="row"><span className="tag t-cyan">✦ BERITA UTAMA</span><SrcTag r={r} /><Tags r={r} /></div>
      <h2><a href={href} data-nid={r.id} target="_blank" rel="noopener" title="Klik untuk detail">{r.title}</a></h2>
      {sum ? <p>{sum.slice(0, 320)}{sum.length > 320 ? '…' : ''}</p> : null}
      {r.impact_reason && !isPending(r) ? <div className="status">{r.impact_reason}</div> : null}
      <div className="row" style={{ marginTop: 'auto', justifyContent: 'space-between' }}>
        <span className="co-wrap"><CoPills r={r} /></span>
        <span className="sm dim">{fullDate(r.published_at)} · {ago(r.published_at)} · <a style={{ color: 'var(--cyan)' }} href={href} target="_blank" rel="noopener">Sumber ↗</a></span>
      </div>
    </article>
  );
}

/** Item ringkas untuk kolom kanan (judul + meta), tinggi kecil supaya kolom seimbang dengan kartu lead. */
export function SideRow({ r }: { r: NewsRow }) {
  const [cover, drop] = useCover(r);
  return (
    <article className="side-row" data-nid={r.id}>
      {cover && /* eslint-disable-next-line @next/next/no-img-element */ <img className="sth" src={`/img/${r.id}`} alt="" loading="lazy" referrerPolicy="no-referrer" onError={drop} />}
      <div className="sb">
        <Link prefetch={false} className="co-pill" style={{ fontSize: 11.5 }} href={`/c/${encodeURIComponent(r.company_id)}`}>{r.company_ticker || r.company_name}</Link>
        <h4><a href={safeUrl(artUrl(r))} data-nid={r.id} target="_blank" rel="noopener">{r.title}</a></h4>
        <div className="m"><span>{r.source_name || r.source_domain || ''}</span><span>{ago(r.published_at)}</span><Tags r={r} compact /></div>
      </div>
    </article>
  );
}
