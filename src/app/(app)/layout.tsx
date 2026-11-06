import '@/styles/shell.css';
import '@/styles/widgets.css';
import type { ReactNode } from 'react';
import AppProvider from '@/components/providers/AppProvider';
import Shell from '@/components/shell/Shell';
import WidgetHost from '@/components/widgets/WidgetHost';

// Kerangka semua halaman utama: sidebar bersama + widget lintas halaman (tooltip, asisten AI, tur).
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppProvider>
      <Shell>{children}</Shell>
      <WidgetHost />
    </AppProvider>
  );
}
