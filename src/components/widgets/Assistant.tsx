'use client';
/* Asisten AI melayang. Logo AI adalah jangkar yang selalu terlihat; jendela chat terbuka di sebelahnya (seolah logo itu yang berbicara) dan
   selalu mengikuti posisi logo, jadi tidak pernah terpisah. Logo bisa ditarik ke mana saja (drag memakai translate + requestAnimationFrame agar mulus)
   dan menempel ke sudut terdekat saat dilepas. Konteks mengikuti halaman: beranda -> perusahaan -> modal berita. Jawaban dirakit server (src/ai/assistant.js).
   Posisi logo/jendela dihitung langsung ke DOM (bukan state React) supaya tarikannya mulus. */
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '@/components/providers/AppProvider';
import { LS, SS } from '@/lib/client/storage';
import { voice } from '@/lib/client/voice';
import { esc } from '@/lib/client/format';
import Robot from './Robot';

const S = 56, M = 14, GAP = 14, PW = 370, SNAP = 130;
const SPK_ON = <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></svg>;
const SPK_OFF = <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M17 9l5 6M22 9l-5 6" /></svg>;

type Cx = { type: string; companyId?: string; newsId?: number };
type Ctx = Cx & { label: string; name?: string };
type Msg = { role: 'user' | 'assistant'; content: string; ctx?: string; ck?: string; cx?: Cx };
type Pos = { corner: string } | { x?: number; y?: number; corner?: undefined };

// Markdown ringan -> HTML. Teks di-escape lebih dulu; hanya tag yang dibuat di sini yang lolos.
const md = (t: string) => {
  const lines = esc(t).split('\n'); let html = '', list = false;
  for (const ln of lines) {
    const li = /^\s*[-•]\s+(.*)$/.exec(ln);
    if (li) { if (!list) { html += '<ul>'; list = true; } html += '<li>' + li[1] + '</li>'; continue; }
    if (list) { html += '</ul>'; list = false; }
    if (ln.trim()) html += '<p>' + ln + '</p>';
  }
  return (html + (list ? '</ul>' : '')).replace(/`/g, '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[([^\]]{1,80})\]\((\/help[.]html(?:#[a-z0-9_-]{1,40})?)\)/g, '<a class="as-ref" href="$2" target="_blank" rel="noopener">$1</a>').replace(/\[berita #(\d+)\]/g, '<a class="as-ref" href="#" data-nid="$1" title="Buka berita #$1">berita #$1</a>');
};
const ctxKey = (c: Cx) => c.type + ':' + (c.companyId || c.newsId || '');
const SUGGEST = {
  home: ['Perusahaan mana yang risikonya paling tinggi saat ini?', 'Ringkas kondisi seluruh portofolio', 'Berita berisiko apa saja yang baru muncul?', 'Perusahaan mana yang datanya belum cukup?'],
  company: (c: Ctx) => ['Ringkas profil risiko ' + c.name, 'Apa temuan deed discovery (pengurus, pemegang saham)?', 'Apa yang perlu diverifikasi di FAP?', 'Bagaimana kondisi keuangannya?'],
  news: ['Jelaskan berita ini secara rinci', 'Kenapa berita ini muncul dan terkait perusahaan?', 'Apa dampaknya ke risiko pinjaman?', 'Apa yang harus diverifikasi dari berita ini?'],
};
const GREETING = 'Halo! Saya asisten analisis risiko. Saya bisa membantu membaca portofolio, profil risiko, temuan deed discovery, dan detail berita dari data yang sudah tersimpan.\n\nPilih pertanyaan di bawah atau ketik sendiri. Tarik logo saya ke sudut mana pun supaya tidak menutupi layar.';

export default function Assistant() {
  const pathname = usePathname();
  const { portfolio, newsId, newsTitle } = useApp();

  const logoRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const msgBox = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const engine = useRef<{ render: () => void } | null>(null);
  const scrollMode = useRef<'bottom' | 'answer'>('bottom');
  const lastCtxKey = useRef('');

  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [voiceOk, setVoiceOk] = useState(false);
  const [text, setText] = useState('');
  const loaded = useRef(false);

  /* ---------- konteks halaman ---------- */
  const ctx: Ctx = (() => {
    if (newsId) return { type: 'news', newsId, label: 'Berita: ' + (newsTitle || 'Memuat…').slice(0, 60) };
    const m = /^\/c\/([^/]+)/.exec(pathname);
    if (m) {
      let id = m[1]; try { id = decodeURIComponent(id); } catch { /* biarkan */ }
      const c = portfolio.find((x) => x.id === id);
      return { type: 'company', companyId: id, label: 'Perusahaan: ' + (c ? c.ticker || c.name : id), name: c ? c.name.replace(/^PT\s+/i, '') : id };
    }
    return { type: 'home', label: 'Beranda · seluruh portofolio' };
  })();
  const key = ctxKey(ctx);

  /* ---------- posisi: logo = jangkar, panel mengikuti (langsung ke DOM) ---------- */
  useEffect(() => {
    const logo = logoRef.current!, panel = panelRef.current!, head = headRef.current!;
    let B = { l: 0, t: 0 };
    let pos: Pos = (LS.get<Pos>('ms.asst.pos')) || { corner: 'br' };

    function bounds() {
      let l = 0, t = 0;
      const side = document.querySelector('.shell-side');
      if (side && innerWidth > 980) l = Math.max(l, side.getBoundingClientRect().right);
      for (const el of document.querySelectorAll('.top, .shell-mbar')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || !/sticky|fixed/.test(cs.position)) continue;
        const r = el.getBoundingClientRect();
        if (r.top <= 1) t = Math.max(t, r.bottom);
      }
      B = { l: Math.round(l), t: Math.round(t) };
    }
    const minX = () => B.l + M, minY = () => B.t + M;
    const maxX = () => Math.max(minX(), innerWidth - S - M), maxY = () => Math.max(minY(), innerHeight - S - M);
    const clampX = (x: number) => Math.min(Math.max(minX(), x), maxX()), clampY = (y: number) => Math.min(Math.max(minY(), y), maxY());
    const coords = (): [number, number] => (pos.corner
      ? [pos.corner.includes('r') ? maxX() : minX(), pos.corner.includes('b') ? maxY() : minY()]
      : [clampX((pos as { x?: number }).x ?? maxX()), clampY((pos as { y?: number }).y ?? maxY())]);
    const isOpen = () => panel.classList.contains('open');
    const small = () => innerWidth <= 560;

    function layoutPanel(x: number, y: number) {
      if (small()) {
        const h = Math.round(Math.min(innerHeight * 0.72, 560));
        panel.style.height = h + 'px'; panel.dataset.side = '';
        panel.style.translate = '8px ' + (innerHeight - h - 8) + 'px'; panel.style.transformOrigin = 'bottom center';
        return;
      }
      const h = Math.min(520, innerHeight - B.t - 16);
      panel.style.height = h + 'px';
      const cx = x + S / 2, cy = y + S / 2;
      let px: number, py: number, side = '';
      const toLeft = cx > (B.l + innerWidth) / 2;
      px = toLeft ? x - GAP - PW : x + S + GAP;
      const left = B.l + 8, top = B.t + 8;
      if (px < left || px + PW > innerWidth - 8) {                  // layar terlalu sempit di samping: taruh di atas/bawah logo
        px = Math.min(Math.max(left, x + S - PW), innerWidth - PW - 8);
        py = cy > innerHeight / 2 ? y - GAP - h : y + S + GAP;
      } else {
        side = toLeft ? 'l' : 'r';
        py = cy > innerHeight / 2 ? y + S - h : y;               // logo di bagian bawah: jendela tumbuh ke atas
      }
      py = Math.min(Math.max(top, py), innerHeight - h - 8);
      panel.dataset.side = side;
      panel.style.setProperty('--ty', Math.min(Math.max(26, cy - py), h - 26) + 'px');
      panel.style.transformOrigin = side ? (side === 'l' ? 'right ' : 'left ') + Math.min(Math.max(0, cy - py), h) + 'px' : 'center';
      panel.style.translate = px + 'px ' + py + 'px';
    }
    function render() {
      bounds();
      const [x, y] = coords();
      logo.style.translate = x + 'px ' + y + 'px';
      layoutPanel(x, y);
      logo.classList.toggle('hide', small() && isOpen());
    }
    let raf = 0;
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };
    let snapTimer: ReturnType<typeof setTimeout> | undefined;
    // Dilepas dekat sudut (di kedua sumbu) -> tertarik ke sudut itu dengan animasi
    function snapToCorner() {
      const [x, y] = coords();
      bounds();
      const dxe = Math.min(x - minX(), maxX() - x), dye = Math.min(y - minY(), maxY() - y);
      if (dxe <= SNAP && dye <= SNAP) pos = { corner: (y < (minY() + maxY()) / 2 ? 't' : 'b') + (x < (minX() + maxX()) / 2 ? 'l' : 'r') };
      logo.classList.add('snap'); panel.classList.add('snap');
      render();
      clearTimeout(snapTimer); snapTimer = setTimeout(() => { logo.classList.remove('snap'); panel.classList.remove('snap'); }, 400);
    }

    // Tarik logo atau header jendela (keduanya menggerakkan logo; jendela ikut). Klik tanpa tarik = onTap.
    const cleanups: (() => void)[] = [];
    function bindDrag(handle: HTMLElement, onTap?: () => void) {
      let sx = 0, sy = 0, ox = 0, oy = 0, moved = false, down = false, pid = 0;
      const onDown = (e: PointerEvent) => {
        if (e.button) return;
        if (handle !== logo && (e.target as HTMLElement).closest('button')) return;
        down = true; moved = false; sx = e.clientX; sy = e.clientY; [ox, oy] = coords(); pid = e.pointerId;
        handle.setPointerCapture?.(pid);
      };
      const onMove = (e: PointerEvent) => {
        if (!down) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (!moved) {
          if (Math.hypot(dx, dy) < 5) return;
          moved = true; logo.classList.add('dragging'); panel.classList.add('dragging'); logo.classList.remove('snap'); panel.classList.remove('snap');
          document.documentElement.style.userSelect = 'none';
        }
        pos = { x: clampX(ox + dx), y: clampY(oy + dy) };
        schedule();
      };
      const end = (cancel: boolean) => {
        if (!down) return; down = false;
        try { handle.releasePointerCapture?.(pid); } catch { /* sudah dilepas */ }
        document.documentElement.style.userSelect = '';
        logo.classList.remove('dragging'); panel.classList.remove('dragging');
        if (moved) { snapToCorner(); LS.set('ms.asst.pos', pos); }
        else if (!cancel && onTap) onTap();
      };
      const up = () => end(false), cancel = () => end(true);
      handle.addEventListener('pointerdown', onDown); handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', cancel);
      cleanups.push(() => { handle.removeEventListener('pointerdown', onDown); handle.removeEventListener('pointermove', onMove); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', cancel); });
    }
    bindDrag(logo, () => window.dispatchEvent(new Event(isOpen() ? 'ms-assistant-close' : 'ms-assistant-open')));
    bindDrag(head);
    addEventListener('resize', schedule);
    engine.current = { render };
    render();
    return () => { cleanups.forEach((f) => f()); removeEventListener('resize', schedule); cancelAnimationFrame(raf); clearTimeout(snapTimer); engine.current = null; };
  }, []);

  /* ---------- buka / tutup (logo tetap ada) ---------- */
  useEffect(() => {
    panelRef.current?.classList.toggle('open', open);
    if (open) logoRef.current?.classList.remove('pulse');
    engine.current?.render();
  }, [open]);

  const openPanel = useCallback(() => {
    setOpen(true); LS.set('ms.asst.open', true);
    if (innerWidth > 560) setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0);
  }, []);
  const closePanel = useCallback(() => { setOpen(false); LS.set('ms.asst.open', false); voice.stop(); }, []);

  /* ---------- pulihkan percakapan & sambut kunjungan pertama ---------- */
  useEffect(() => {
    const saved = (LS.get<Msg[]>('ms.asst.msgs') || []);
    setMsgs(saved);
    lastCtxKey.current = LS.get<string>('ms.asst.ctx') || '';
    loaded.current = true;
    setVoiceOk(voice.supported); setVoiceOn(voice.enabled);
    logoRef.current?.classList.add('pulse');
    SS.set('ms.asst.seen', true);
    // kunjungan pertama disapa tur (Tour), bukan panel chat
    if (LS.get('ms.tour') != null && LS.get('ms.asst.open')) setTimeout(openPanel, 200);
  }, [openPanel]);
  useEffect(() => { if (loaded.current) LS.set('ms.asst.msgs', msgs.slice(-40)); }, [msgs]);

  // konteks berganti saat jendela terbuka: sapa bila belum ada percakapan
  useEffect(() => {
    if (!open || !loaded.current) return;
    if (key !== lastCtxKey.current) {
      lastCtxKey.current = key; LS.set('ms.asst.ctx', key);
      setMsgs((m) => (m.length ? m : [{ role: 'assistant', content: GREETING }]));
    }
  }, [open, key]);

  /* ---------- suara ---------- */
  useEffect(() => {
    const onPref = () => setVoiceOn(voice.enabled);
    const onSpeak = (e: Event) => {
      const on = !!(e as CustomEvent).detail?.speaking;
      logoRef.current?.classList.toggle('talk', on);
      panelRef.current?.querySelector('.as-av')?.classList.toggle('talk', on);
    };
    window.addEventListener('ms-voice-pref', onPref); window.addEventListener('ms-voice', onSpeak);
    return () => { window.removeEventListener('ms-voice-pref', onPref); window.removeEventListener('ms-voice', onSpeak); };
  }, []);

  /* ---------- percakapan ---------- */
  const msgsRef = useRef(msgs); msgsRef.current = msgs;
  const busyRef = useRef(busy); busyRef.current = busy;
  const ask = useCallback(async (raw: string, ctxOverride?: Ctx) => {
    const t = String(raw || '').trim();
    if (!t || busyRef.current) return;
    openPanel();
    const cx0 = ctxOverride || ctx;
    const cx: Cx = { type: cx0.type, companyId: cx0.companyId, newsId: cx0.newsId };
    const lastAns = [...msgsRef.current].reverse().find((m) => m.role === 'assistant' && m.cx);
    const prev = lastAns && ctxKey(lastAns.cx!) !== ctxKey(cx0) ? lastAns.cx : null;      // halaman sudah berganti sejak jawaban terakhir
    voice.stop();                                                                          // pertanyaan baru: hentikan suara yang masih berjalan
    const userMsg: Msg = { role: 'user', content: t, ck: ctxKey(cx0), cx };
    const next = [...msgsRef.current, userMsg];
    setMsgs(next); setBusy(true); busyRef.current = true;
    try {
      const history = next.slice(-7).map((m) => ({ role: m.role, content: m.content, cx: m.cx }));      // tiap giliran membawa halaman tempat ia terjadi (memori percakapan)
      const r = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history, context: cx, prev }) });
      const body = await r.text();
      let j: any = null;
      try { j = JSON.parse(body); } catch { /* bukan JSON */ }
      if (!j) throw new Error(r.status === 404 || /^\s*<!doctype|<html/i.test(body)
        ? 'server ini belum memuat fitur asisten (kemungkinan belum di-restart). Restart server, lalu muat ulang halaman.'
        : 'balasan server tidak dapat dibaca (HTTP ' + r.status + ')');
      if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
      scrollMode.current = 'answer';
      setMsgs((m) => [...m, { role: 'assistant', content: j.answer, ctx: cx0.label, cx }]);
      voice.speak(j.answer);                              // jawaban dibacakan dengan suara robot (bisa dibisukan)
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: 'Maaf, gagal menjawab: ' + (e as Error).message }]);
    }
    setBusy(false); busyRef.current = false;
  }, [ctx, openPanel]);                                    // eslint-disable-line react-hooks/exhaustive-deps

  // API untuk komponen lain (tombol AI di modal berita, tur, tombol Tur): lewat peristiwa jendela
  const askRef = useRef(ask); askRef.current = ask;
  useEffect(() => {
    const onOpen = () => { openPanel(); setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0); };
    const onClose = () => closePanel();
    const onAsk = (e: Event) => { const d = (e as CustomEvent).detail; openPanel(); askRef.current(d.text, d.ctx); };
    window.addEventListener('ms-assistant-open', onOpen); window.addEventListener('ms-assistant-close', onClose); window.addEventListener('ms-assistant-ask', onAsk);
    return () => { window.removeEventListener('ms-assistant-open', onOpen); window.removeEventListener('ms-assistant-close', onClose); window.removeEventListener('ms-assistant-ask', onAsk); };
  }, [openPanel, closePanel]);

  // gulir otomatis ke bawah setiap ada chat baru; jawaban yang panjang ditampilkan mulai dari awalnya agar tidak terlewat
  useLayoutEffect(() => {
    const box = msgBox.current; if (!box) return;
    const answers = box.querySelectorAll<HTMLElement>('.as-b.a:not(.as-dots)');
    const lastAns = answers[answers.length - 1];
    if (scrollMode.current === 'answer' && lastAns && lastAns.offsetHeight > box.clientHeight * 0.75) box.scrollTop = lastAns.offsetTop - 8;
    else box.scrollTop = box.scrollHeight;
    scrollMode.current = 'bottom';
  }, [msgs, busy, open]);

  // Rekomendasi pertanyaan hanya muncul bila belum ada pertanyaan sejak awal percakapan atau sejak pergantian konteks.
  const showChips = !busy && !msgs.some((m) => m.role === 'user' && m.ck === key);
  const chips = ctx.type === 'company' ? SUGGEST.company(ctx) : ctx.type === 'news' ? SUGGEST.news : SUGGEST.home;

  function send() { const v = text; setText(''); ask(v); }

  return (
    <>
      <div id="asst-panel" ref={panelRef} role="dialog" aria-label="Asisten AI">
        <div className="as-h" id="as-h" ref={headRef}>
          <span className="as-av"><Robot n={32} id="h" /></span>
          <div style={{ flex: 1, minWidth: 0 }}><b>Asisten AI</b><div className="as-ctx" id="as-ctx">{ctx.label}</div></div>
          <button type="button" id="as-tour" title="Tur fitur::Ulangi tur singkat yang dipandu suara." aria-label="Tur fitur" onClick={() => window.dispatchEvent(new Event('ms-tour-start'))}>?</button>
          <button type="button" id="as-voice" aria-label="Suara" hidden={!voiceOk} onClick={() => voice.setEnabled(!voice.enabled)}
            title={voiceOn ? 'Suara aktif::Jawaban dibacakan dengan suara robot. Klik untuk membisukan.' : 'Suara mati::Klik untuk menyalakan suara robot.'}>{voiceOn ? SPK_ON : SPK_OFF}</button>
          <button type="button" id="as-clear" title="Percakapan baru::Hapus riwayat chat dan mulai dari awal." onClick={() => { lastCtxKey.current = key; LS.set('ms.asst.ctx', key); setMsgs([{ role: 'assistant', content: GREETING }]); }}>↺</button>
          <button type="button" id="as-min" title="Tutup::Tutup jendela chat. Logo AI tetap di layar." aria-label="Tutup" onClick={closePanel}>✕</button>
        </div>
        <div className="as-m" id="as-m" ref={msgBox}>
          {msgs.map((m, i) => m.role === 'user'
            ? <div key={i} className="as-b u">{m.content}</div>
            : <div key={i} className="as-b a">{m.ctx ? <div className="as-cx">Konteks: {m.ctx}</div> : null}<span dangerouslySetInnerHTML={{ __html: md(m.content) }} /></div>)}
          {busy && <div className="as-b a as-dots"><span></span><span></span><span></span></div>}
          {showChips && <div className="as-chips">{chips.slice(0, 4).map((q) => <button key={q} type="button" className="as-chip" onClick={() => ask(q)}>{q}</button>)}</div>}
        </div>
        <div className="as-f">
          <textarea id="as-in" ref={inputRef} placeholder="Tanya tentang portofolio, perusahaan, atau berita…" rows={1} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}></textarea>
          <button type="button" id="as-send" disabled={busy} onClick={send}>Kirim</button>
        </div>
        <div className="as-note">Jawaban dari data tersimpan, bukan keputusan kredit. Periksa rujukan.</div>
      </div>
      <button id="asst-logo" ref={logoRef} type="button" aria-label="Asisten AI" title="Asisten AI::Klik untuk bertanya. Tarik untuk memindahkan; lepas di dekat sudut area konten agar menempel."><Robot n={46} id="l" /></button>
    </>
  );
}
