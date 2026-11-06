import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'Diagnosa koneksi' };

export default function DiagnoseLayout({ children }: { children: ReactNode }) {
  return children;
}
