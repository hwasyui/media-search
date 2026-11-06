'use client';
// Status filter penjelajah berita yang bertahan selama pengguna berpindah halaman (dulu objek global S.feed / CS.feed).
// Kunci: 'home' untuk Beranda, id perusahaan untuk tab Berita perusahaan.
import { useSyncExternalStore } from 'react';
import { type FeedState, newFeedState } from './types';

const states = new Map<string, FeedState>();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };

export function getFeed(key: string): FeedState {
  let s = states.get(key);
  if (!s) { s = newFeedState(); states.set(key, s); }
  return s;
}
export function setFeed(key: string, patch: Partial<FeedState>) { states.set(key, { ...getFeed(key), ...patch }); emit(); }
/** Kembalikan semua filter ke bawaan, tetapi panel filter lanjutan tetap terbuka/tertutup seperti sebelumnya. */
export function resetFeed(key: string) { states.set(key, { ...newFeedState(), _adv: getFeed(key)._adv }); emit(); }

export const useFeed = (key: string) => useSyncExternalStore(subscribe, () => getFeed(key), () => getFeed(key));
