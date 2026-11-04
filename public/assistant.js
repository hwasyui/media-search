/* Asisten AI melayang (robot): muncul sejak halaman dibuka, bisa ditarik ke mana saja agar tidak menutupi isi, dan konteksnya mengikuti halaman:
   beranda (portofolio) -> halaman perusahaan -> modal berita. Jawaban dirakit server dari DB; lihat src/assistant.js. */
(() => {
  'use strict';
  const LS = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } };
  const SS = (k, v) => { try { if (v === undefined) return JSON.parse(sessionStorage.getItem(k)); sessionStorage.setItem(k, JSON.stringify(v)); } catch { return null; } };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const ROBOT = '<svg viewBox="0 0 32 32" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3v4"/><circle cx="16" cy="3" r="1.4" fill="currentColor"/><rect x="5" y="8" width="22" height="17" rx="4"/><circle cx="12" cy="16" r="2.2" fill="currentColor" stroke="none"/><circle cx="20" cy="16" r="2.2" fill="currentColor" stroke="none"/><path d="M12 21h8"/><path d="M2 15v4M30 15v4"/></svg>';

  const css = document.createElement('style');
  css.textContent = `
  #asst-bubble{position:fixed;z-index:80;width:56px;height:56px;border-radius:50% !important;background:var(--cyan,#4c8dff);color:#fff;border:0;display:grid;place-items:center;cursor:grab;box-shadow:0 8px 28px rgba(0,0,0,.55);touch-action:none;user-select:none}
  #asst-bubble:active{cursor:grabbing} #asst-bubble.pulse::after{content:"";position:absolute;inset:-5px;border-radius:50% !important;border:2px solid var(--cyan,#4c8dff);opacity:.6;animation:asstp 1.8s ease-out infinite}
  @keyframes asstp{to{transform:scale(1.35);opacity:0}}
  #asst-panel{position:fixed;z-index:80;width:370px;max-width:calc(100vw - 16px);height:520px;max-height:calc(100vh - 16px);display:flex;flex-direction:column;background:var(--panel,#0f1318);border:1px solid var(--line2,#2e3641);box-shadow:0 18px 60px rgba(0,0,0,.7);color:var(--text,#e6e9ed);font:13.5px/1.55 inherit}
  #asst-panel[hidden],#asst-bubble[hidden]{display:none}
  .as-h{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line,#232932);cursor:grab;user-select:none;touch-action:none;background:var(--panel2,#141920)}
  .as-h:active{cursor:grabbing} .as-h .ic{color:var(--cyan,#4c8dff);display:grid} .as-h b{font-size:14px}
  .as-ctx{font-size:11.5px;color:var(--muted,#8a93a0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .as-h button{background:none;border:0;color:var(--muted,#8a93a0);cursor:pointer;font-size:15px;padding:2px 6px;line-height:1} .as-h button:hover{color:var(--text,#e6e9ed)}
  .as-m{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
  .as-b{max-width:92%;padding:9px 12px;white-space:normal;word-wrap:break-word}
  .as-b.u{align-self:flex-end;background:var(--cyan,#4c8dff);color:#fff} .as-b.a{align-self:flex-start;background:var(--panel2,#141920);border:1px solid var(--line,#232932)}
  .as-b ul{margin:6px 0 2px;padding-left:18px} .as-b p{margin:0 0 6px} .as-b p:last-child{margin:0}
  .as-cx{font-size:11px;color:var(--dim,#5b636e);margin-bottom:5px;padding-bottom:4px;border-bottom:1px dashed var(--line,#232932)}
  .as-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
  .as-chip{background:var(--bg,#0b0d10);border:1px solid var(--line2,#2e3641);color:var(--text,#e6e9ed);padding:5px 10px;font-size:12px;cursor:pointer;text-align:left}
  .as-chip:hover{border-color:var(--cyan,#4c8dff);color:var(--cyan,#4c8dff)}
  .as-f{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line,#232932)}
  .as-f textarea{flex:1;resize:none;height:38px;max-height:90px;background:var(--bg,#0b0d10);border:1px solid var(--line2,#2e3641);color:var(--text,#e6e9ed);padding:8px 10px;font:inherit}
  .as-f button{background:var(--cyan,#4c8dff);color:#fff;border:0;padding:0 14px;font-weight:700;cursor:pointer} .as-f button:disabled{opacity:.5;cursor:wait}
  .as-note{font-size:11px;color:var(--dim,#5b636e);padding:0 12px 8px}
  .as-dots span{display:inline-block;width:6px;height:6px;background:var(--muted,#8a93a0);margin-right:4px;animation:asd 1s infinite} .as-dots span:nth-child(2){animation-delay:.15s} .as-dots span:nth-child(3){animation-delay:.3s}
  @keyframes asd{50%{opacity:.25}}
  @media (max-width:560px){#asst-panel{width:calc(100vw - 16px);height:min(72vh,560px)} #asst-bubble{width:52px;height:52px} .as-b{max-width:96%}}
  @media print{#asst-bubble,#asst-panel{display:none !important}}`;
  document.head.appendChild(css);

  const bubble = document.createElement('button');
  bubble.id = 'asst-bubble'; bubble.type = 'button'; bubble.title = 'Tanya asisten AI (tarik untuk memindahkan)'; bubble.innerHTML = ROBOT; bubble.classList.add('pulse');
  const panel = document.createElement('div');
  panel.id = 'asst-panel'; panel.hidden = true;
  panel.innerHTML = '<div class="as-h" id="as-h"><span class="ic">' + ROBOT.replace('width="30" height="30"', 'width="24" height="24"') + '</span><div style="flex:1;min-width:0"><b>Asisten AI</b><div class="as-ctx" id="as-ctx"></div></div>'
    + '<button type="button" id="as-clear" title="Mulai percakapan baru">↺</button><button type="button" id="as-min" title="Kecilkan menjadi robot">–</button></div>'
    + '<div class="as-m" id="as-m"></div>'
    + '<div class="as-f"><textarea id="as-in" placeholder="Tanya tentang portofolio, perusahaan, atau berita…" rows="1"></textarea><button type="button" id="as-send">Kirim</button></div>'
    + '<div class="as-note">Jawaban dari data tersimpan, bukan keputusan kredit. Periksa rujukan.</div>';
  document.body.append(bubble, panel);
  const $ = (id) => panel.querySelector('#' + id);

  /* ---------- posisi & tarik ---------- */
  const clamp = (x, y, w, h) => [Math.min(Math.max(8, x), Math.max(8, innerWidth - w - 8)), Math.min(Math.max(8, y), Math.max(8, innerHeight - h - 8))];
  const place = (el, key, defX, defY) => {
    const p = LS(key) || { x: defX(), y: defY() };
    const [x, y] = clamp(p.x, p.y, el.offsetWidth || 56, el.offsetHeight || 56);
    el.style.left = x + 'px'; el.style.top = y + 'px';
  };
  function draggable(el, handle, key, onClick) {
    let sx, sy, ox, oy, moved = false, down = false;
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') && handle !== el) return;
      down = true; moved = false; sx = e.clientX; sy = e.clientY; ox = el.offsetLeft; oy = el.offsetTop;
      handle.setPointerCapture?.(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!down) return;
      if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 4) moved = true;
      if (!moved) return;
      const [x, y] = clamp(ox + e.clientX - sx, oy + e.clientY - sy, el.offsetWidth, el.offsetHeight);
      el.style.left = x + 'px'; el.style.top = y + 'px';
    });
    const end = () => { if (!down) return; down = false; if (moved) LS(key, { x: el.offsetLeft, y: el.offsetTop }); else if (onClick) onClick(); };
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', () => { down = false; });
  }

  /* ---------- konteks ---------- */
  const portfolio = () => window.S?.portfolio || window.shellPortfolio || [];
  function currentContext() {
    if (window.__nwId) return { type: 'news', newsId: Number(window.__nwId), label: 'Berita: ' + (document.getElementById('nwTitle')?.textContent || '').slice(0, 60) };
    const m = /^#\/c\/([^/]+)/.exec(location.hash);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const c = portfolio().find((x) => x.id === id);
      return { type: 'company', companyId: id, label: 'Perusahaan: ' + (c ? c.ticker || c.name : id), name: c ? c.name.replace(/^PT\s+/i, '') : id };
    }
    return { type: 'home', label: 'Beranda · seluruh portofolio' };
  }
  const SUGGEST = {
    home: ['Perusahaan mana yang risikonya paling tinggi saat ini?', 'Ringkas kondisi seluruh portofolio', 'Berita berisiko apa saja yang baru muncul?', 'Perusahaan mana yang datanya belum cukup?'],
    company: (c) => ['Ringkas profil risiko ' + c.name, 'Apa temuan deed discovery (pengurus, pemegang saham)?', 'Apa yang perlu diverifikasi di FAP?', 'Bagaimana kondisi keuangannya?'],
    news: ['Jelaskan berita ini secara rinci', 'Kenapa berita ini muncul dan terkait perusahaan?', 'Apa dampaknya ke risiko pinjaman?', 'Apa yang harus diverifikasi dari berita ini?'],
  };
  const suggestionsFor = (ctx) => (ctx.type === 'company' ? SUGGEST.company(ctx) : SUGGEST[ctx.type]);

  /* ---------- percakapan ---------- */
  let msgs = (LS('ms.asst.msgs') || []).filter((m) => !m.sep);          // [{role, content, ctx?}] untuk ditampilkan & dikirim
  let lastCtxKey = LS('ms.asst.ctx') || '';
  let busy = false;
  const md = (t) => {
    const lines = esc(t).split('\n'); let html = '', list = false;
    for (const ln of lines) {
      const li = /^\s*[-•]\s+(.*)$/.exec(ln);
      if (li) { if (!list) { html += '<ul>'; list = true; } html += '<li>' + li[1] + '</li>'; continue; }
      if (list) { html += '</ul>'; list = false; }
      if (ln.trim()) html += '<p>' + ln + '</p>';
    }
    return (html + (list ? '</ul>' : '')).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  };
  // Rekomendasi pertanyaan hanya muncul bila belum ada pertanyaan sejak awal percakapan atau sejak pergantian konteks.
  const ctxKey = (c) => c.type + ':' + (c.companyId || c.newsId || '');
  function showChips() {
    if (busy) return false;
    const k = ctxKey(currentContext());
    return !msgs.some((m) => m.role === 'user' && m.ck === k);
  }
  let scrollMode = 'bottom';                    // 'bottom' | 'answer' (awal jawaban terlihat bila jawabannya panjang)
  function draw() {
    const box = $('as-m');
    box.innerHTML = msgs.map((m) => '<div class="as-b ' + (m.role === 'user' ? 'u' : 'a') + '">' + (m.role === 'user' ? esc(m.content) : (m.ctx ? '<div class="as-cx">Konteks: ' + esc(m.ctx) + '</div>' : '') + md(m.content)) + '</div>').join('')
      + (busy ? '<div class="as-b a as-dots"><span></span><span></span><span></span></div>' : '')
      + (showChips() ? '<div class="as-chips">' + suggestionsFor(currentContext()).slice(0, 4).map((q) => '<button type="button" class="as-chip">' + esc(q) + '</button>').join('') + '</div>' : '');
    box.querySelectorAll('.as-chip').forEach((b) => (b.onclick = () => ask(b.textContent)));
    // gulir otomatis ke bawah setiap ada chat baru; jawaban yang panjang ditampilkan mulai dari awalnya agar tidak terlewat
    const answers = box.querySelectorAll('.as-b.a:not(.as-dots)');
    const lastAns = answers[answers.length - 1];
    if (scrollMode === 'answer' && lastAns && lastAns.offsetHeight > box.clientHeight * 0.75) box.scrollTop = lastAns.offsetTop - 8;
    else box.scrollTop = box.scrollHeight;
    scrollMode = 'bottom';
    LS('ms.asst.msgs', msgs.slice(-40));
  }
  function syncContext(force) {
    const ctx = currentContext();
    $('as-ctx').textContent = ctx.label;
    const key = ctx.type + ':' + (ctx.companyId || ctx.newsId || '');
    if (key !== lastCtxKey) {
      lastCtxKey = key; LS('ms.asst.ctx', key);
      if (!msgs.length) greet();
      draw();
    }
  }
  function greet() {
    msgs.push({ role: 'assistant', content: 'Halo! Saya asisten analisis risiko. Saya bisa membantu membaca portofolio, profil risiko, temuan deed discovery, dan detail berita dari data yang sudah tersimpan.\n\nPilih pertanyaan di bawah atau ketik sendiri. Kamu bisa menarik saya ke tempat lain supaya tidak menutupi layar.' });
  }

  async function ask(text, ctxOverride) {
    text = String(text || '').trim();
    if (!text || busy) return;
    openPanel();
    const ctx = ctxOverride || currentContext();
    msgs.push({ role: 'user', content: text, ck: ctxKey(ctx) });
    busy = true; $('as-send').disabled = true; draw();      // rekomendasi hilang saat pertanyaan dikirim; yang baru muncul bersama jawaban
    try {
      const history = msgs.filter((m) => !m.sep).slice(-7).map((m) => ({ role: m.role, content: m.content }));
      const r = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history, context: { type: ctx.type, companyId: ctx.companyId, newsId: ctx.newsId } }) });
      const raw = await r.text();
      let j = null;
      try { j = JSON.parse(raw); } catch { /* bukan JSON */ }
      if (!j) throw new Error(r.status === 404 || /^\s*<!doctype|<html/i.test(raw)
        ? 'server ini belum memuat fitur asisten (kemungkinan belum di-restart). Restart server, lalu muat ulang halaman.'
        : 'balasan server tidak dapat dibaca (HTTP ' + r.status + ')');
      if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
      msgs.push({ role: 'assistant', content: j.answer, ctx: ctx.label });
      scrollMode = 'answer';
    } catch (e) {
      msgs.push({ role: 'assistant', content: 'Maaf, gagal menjawab: ' + e.message });
    }
    busy = false; $('as-send').disabled = false; draw();
  }

  /* ---------- buka / tutup ---------- */
  function openPanel() {
    if (!panel.hidden) return;
    panel.hidden = false; bubble.hidden = true; LS('ms.asst.open', true);
    place(panel, 'ms.asst.panel', () => innerWidth - 390, () => innerHeight - 540);
    syncContext(); $('as-in').focus();
  }
  function closePanel() { panel.hidden = true; bubble.hidden = false; bubble.classList.remove('pulse'); LS('ms.asst.open', false); place(bubble, 'ms.asst.bubble', () => innerWidth - 80, () => innerHeight - 80); }

  draggable(panel, $('as-h'), 'ms.asst.panel');
  draggable(bubble, bubble, 'ms.asst.bubble', openPanel);
  $('as-min').onclick = closePanel;
  $('as-clear').onclick = () => { msgs = []; lastCtxKey = ''; LS('ms.asst.ctx', ''); syncContext(true); };
  $('as-send').onclick = () => { const v = $('as-in').value; $('as-in').value = ''; ask(v); };
  $('as-in').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('as-send').click(); } });
  addEventListener('hashchange', () => !panel.hidden && syncContext());
  addEventListener('ms-context', () => !panel.hidden && syncContext());
  addEventListener('resize', () => { place(bubble, 'ms.asst.bubble', () => innerWidth - 80, () => innerHeight - 80); if (!panel.hidden) place(panel, 'ms.asst.panel', () => innerWidth - 390, () => innerHeight - 540); });

  // API untuk komponen lain (mis. tombol "Tanya AI" di modal berita)
  window.assistantAsk = (text, ctx) => { openPanel(); syncContext(); ask(text, ctx); };

  // Tampil sejak halaman dibuka: panel terbuka di kunjungan pertama sesi ini; setelahnya mengikuti pilihan terakhir (robot kecil bila ditutup)
  place(bubble, 'ms.asst.bubble', () => innerWidth - 80, () => innerHeight - 80);
  const first = SS('ms.asst.seen') == null;
  SS('ms.asst.seen', true);
  if (first || LS('ms.asst.open')) setTimeout(openPanel, first ? 900 : 200); else bubble.hidden = false;
})();
