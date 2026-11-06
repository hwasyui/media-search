import type { Metadata } from 'next';
import CompanyPage from '@/components/portal/CompanyPage';

export const metadata: Metadata = { title: 'Perusahaan' };

const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

export default async function CompanyRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CompanyPage key={id} id={decode(id)} />;
}
