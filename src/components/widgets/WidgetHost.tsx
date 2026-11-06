'use client';
// Widget lintas halaman yang tidak punya tampilan React: tooltip bergaya (title="Judul::isi") dan suara.
import { useEffect } from 'react';
import { initTooltip } from '@/lib/client/tooltip';
import { initVoice } from '@/lib/client/voice';

export default function WidgetHost() {
  useEffect(() => {
    const offTip = initTooltip();
    const offVoice = initVoice();
    return () => { offTip(); offVoice(); };
  }, []);
  return null;
}
