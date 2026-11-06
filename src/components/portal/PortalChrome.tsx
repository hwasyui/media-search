'use client';
// Bagian kerangka portal yang bukan halaman: toast, dan klik-di-mana-pun pada berita membuka modal detail.
import { useEffect } from 'react';
import { useApp } from '@/components/providers/AppProvider';

export function ToastView() {
  const { toastMsg } = useApp();
  return <div className="toast" id="toast" hidden={toastMsg == null}>{toastMsg}</div>;
}

/* Klik di mana pun pada kartu/baris berita (elemen ber-atribut data-nid) membuka modal.
   Pengecualian: tautan lain ("Sumber ↗", nama perusahaan), tombol, dan isian tetap berfungsi normal.
   Ctrl/Cmd/Shift-klik pada judul tetap membuka artikel di tab baru. */
export function NewsClickDelegate() {
  const { openNews } = useApp();
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (e.button || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (!t?.closest) return;
      const host = t.closest('[data-nid]') as HTMLElement | null;
      if (!host) return;
      const link = t.closest('a');
      if (link && !link.hasAttribute('data-nid')) return;                       // tautan lain: biarkan
      if (t.closest('button, input, select, textarea, label')) return;
      if (link && (e.ctrlKey || e.metaKey || e.shiftKey)) return;               // buka artikel di tab baru
      e.preventDefault();
      openNews(host.dataset.nid!);
    };
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, [openNews]);
  return null;
}

/** Alamat lama berbentuk /portal.html#/c/<id> (setelah redirect menjadi /#/c/<id>) diarahkan ke /c/<id>. */
export function LegacyHash() {
  useEffect(() => {
    const m = /^#\/c\/([^/]+)/.exec(location.hash);
    if (m) location.replace('/c/' + m[1]);
  }, []);
  return null;
}
