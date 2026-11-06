'use client';
// State bersama seluruh aplikasi: lapis data, klien API, portofolio, toast, dan modal berita.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import type { Company, Layer } from '@/lib/client/types';

const LAYER_KEY = 'ms-layer';
const subscribe = (cb: () => void) => { window.addEventListener('storage', cb); return () => window.removeEventListener('storage', cb); };
const readLayer = (): Layer => { try { const v = localStorage.getItem(LAYER_KEY); return v === 'cleaned' || v === 'mentah' ? v : 'relevan'; } catch { return 'relevan'; } };

type Api = <T = any>(url: string, opt?: RequestInit) => Promise<T>;

interface AppCtx {
  layer: Layer;
  /** Ganti lapis data lalu muat ulang halaman (seperti perilaku lama). */
  setLayer: (l: Layer) => void;
  api: Api;
  portfolio: Company[];
  reloadPortfolio: () => Promise<void>;
  toast: (msg: string, ms?: number) => void;
  toastMsg: string | null;
  newsId: number | null;
  newsTitle: string;
  openNews: (id: number | string) => void;
  closeNews: () => void;
  /** Naik tiap kali data perlu dimuat ulang di halaman yang sedang tampil (mis. setelah "Perbarui semua"). */
  dataVersion: number;
  bumpData: () => void;
  setNewsTitle: (t: string) => void;
}

const Ctx = createContext<AppCtx | null>(null);
export const useApp = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp harus di dalam <AppProvider>');
  return c;
};

export default function AppProvider({ children }: { children: ReactNode }) {
  const layer = useSyncExternalStore(subscribe, readLayer, () => 'relevan' as Layer);
  const pathname = usePathname();
  const [portfolio, setPortfolio] = useState<Company[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [newsId, setNewsId] = useState<number | null>(null);
  const [newsTitle, setNewsTitle] = useState('');
  const [dataVersion, setDataVersion] = useState(0);
  const bumpData = useCallback(() => setDataVersion((v) => v + 1), []);

  // Lapis data dikirim ke semua /api/news, /api/portfolio, dan overview perusahaan (kecuali detail satu berita).
  const api = useCallback<Api>(async (url, opt) => {
    if (layer !== 'relevan' && /^\/api\/(news(\?|\/facets)|portfolio|company\/[^/?]+\/overview)/.test(url)) url += (url.includes('?') ? '&' : '?') + 'layer=' + layer;
    const r = await fetch(url, opt);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }, [layer]);

  const setLayer = useCallback((l: Layer) => {
    try { localStorage.setItem(LAYER_KEY, l); } catch { /* abaikan */ }
    location.reload();
  }, []);

  const toast = useCallback((msg: string, ms = 4500) => {
    setToastMsg(msg);
    clearTimeout((toast as any).t);
    (toast as any).t = setTimeout(() => setToastMsg(null), ms);
  }, []);

  const reloadPortfolio = useCallback(async () => { setPortfolio(await api<Company[]>('/api/portfolio')); }, [api]);
  // Dimuat saat awal dan setiap berpindah halaman (seperti route() lama)
  useEffect(() => { reloadPortfolio().catch((e: Error) => toast('Gagal memuat portofolio: ' + e.message, 8000)); }, [reloadPortfolio, pathname, toast]);

  const openNews = useCallback((id: number | string) => { setNewsId(Number(id)); setNewsTitle(''); }, []);
  const closeNews = useCallback(() => { setNewsId(null); setNewsTitle(''); }, []);

  const value = useMemo<AppCtx>(() => ({ layer, setLayer, api, portfolio, reloadPortfolio, toast, toastMsg, newsId, newsTitle, openNews, closeNews, dataVersion, bumpData, setNewsTitle }),
    [layer, setLayer, api, portfolio, reloadPortfolio, toast, toastMsg, newsId, newsTitle, openNews, closeNews, dataVersion, bumpData]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
