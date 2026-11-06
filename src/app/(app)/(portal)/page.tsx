import type { Metadata } from 'next';
import Explorer from '@/components/portal/Explorer';
import { LegacyHash } from '@/components/portal/PortalChrome';

export const metadata: Metadata = { title: 'Portal Berita' };

export default function HomePage() {
  return (
    <>
      <LegacyHash />
      <div className="eyebrow">PORTAL BERITA · SEMUA PERUSAHAAN</div>
      <div id="exploreMount"><Explorer feedKey="home" lead chips /></div>
    </>
  );
}
