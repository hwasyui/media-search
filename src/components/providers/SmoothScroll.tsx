'use client';
import { useEffect } from 'react';

/** Gulir halus untuk tautan #bagian di halaman ini saja (dulu html{scroll-behavior:smooth} milik halaman HELP). */
export default function SmoothScroll() {
  useEffect(() => {
    const el = document.documentElement;
    const prev = el.style.scrollBehavior;
    el.style.scrollBehavior = 'smooth';
    return () => { el.style.scrollBehavior = prev; };
  }, []);
  return null;
}
