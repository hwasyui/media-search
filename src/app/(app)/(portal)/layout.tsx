import '@/styles/portal.css';
import type { ReactNode } from 'react';
import Assistant from '@/components/widgets/Assistant';
import Tour from '@/components/widgets/Tour';
import NewsModal from '@/components/portal/NewsModal';
import { NewsClickDelegate, ToastView } from '@/components/portal/PortalChrome';
import TopBar from '@/components/portal/TopBar';

// Kerangka halaman portal (Beranda dan halaman perusahaan): bilah atas, modal detail berita, toast, asisten AI, dan tur.
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="pg-portal">
        <div className="app">
          <div className="main">
            <TopBar />
            <div className="page" id="view">{children}</div>
          </div>
        </div>
        <NewsModal />
        <ToastView />
        <NewsClickDelegate />
      </div>
      <Assistant />
      <Tour />
    </>
  );
}
