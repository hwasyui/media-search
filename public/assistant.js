/* Asisten AI melayang. Logo AI adalah jangkar yang selalu terlihat; jendela chat terbuka di sebelahnya (seolah logo itu yang berbicara) dan
   selalu mengikuti posisi logo, jadi tidak pernah terpisah. Logo bisa ditarik ke mana saja (drag memakai transform + requestAnimationFrame agar mulus)
   dan menempel ke sudut terdekat saat dilepas. Konteks mengikuti halaman: beranda -> perusahaan -> modal berita. Jawaban dirakit server (src/assistant.js). */
(() => {
  'use strict';
  const LS = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } };
  const SS = (k, v) => { try { if (v === undefined) return JSON.parse(sessionStorage.getItem(k)); sessionStorage.setItem(k, JSON.stringify(v)); } catch { return null; } };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // Kepala robot: antena, kepala berwarna perak-biru, telinga, layar wajah gelap dengan mata menyala yang berkedip
  const ROBOT = (n, id) => '<svg viewBox="0 0 40 40" width="' + n + '" height="' + n + '" aria-hidden="true"><defs><linearGradient id="rb' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f7ff"/><stop offset="1" stop-color="#9db3e8"/></linearGradient></defs>'
    + '<path d="M20 9V4.5" stroke="#8aa4e6" stroke-width="2.2" stroke-linecap="round"/><circle class="rb-ant" cx="20" cy="3.6" r="2.6" fill="#ff6b8a"/>'
    + '<rect x="1.5" y="17" width="5" height="10" rx="2.5" fill="#7f97d6"/><rect x="33.5" y="17" width="5" height="10" rx="2.5" fill="#7f97d6"/>'
    + '<rect x="5" y="9" width="30" height="25" rx="8" fill="url(#rb' + id + ')" stroke="#6c84c8" stroke-width="1.4"/>'
    + '<rect x="9" y="14" width="22" height="14" rx="6" fill="#101a35"/>'
    + '<rect class="rb-eye" x="13.2" y="18" width="4.6" height="6.4" rx="2.3" fill="#5ef2ff"/><rect class="rb-eye" x="22.2" y="18" width="4.6" height="6.4" rx="2.3" fill="#5ef2ff"/>'
    + '<path d="M17 31.2h6" stroke="#6c84c8" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const S = 56, M = 14, GAP = 14, PW = 370, SNAP = 130;

  const css = document.createElement('style');
  css.textContent = `
  #asst-logo{position:fixed;left:0;top:0;z-index:81;width:${S}px;height:${S}px;padding:0;border:0;background:none;display:grid;place-items:center;cursor:grab;
    filter:drop-shadow(0 8px 14px rgba(0,0,0,.55)) drop-shadow(0 0 14px rgba(94,242,255,.28));touch-action:none;user-select:none;-webkit-user-select:none;will-change:translate;transition:scale .15s,filter .2s}
  #asst-logo:hover{scale:1.1;filter:drop-shadow(0 10px 16px rgba(0,0,0,.6)) drop-shadow(0 0 20px rgba(94,242,255,.55))}
  #asst-logo svg{animation:rbbob 3.2s ease-in-out infinite;overflow:visible} #asst-logo:hover svg{animation-duration:1.2s}
  .rb-eye{transform-box:fill-box;transform-origin:center;animation:rbblink 4.5s infinite} .rb-ant{animation:rbant 1.8s ease-in-out infinite}
  #asst-logo.talk svg,.as-av.talk svg{animation:rbbob .5s ease-in-out infinite} #asst-logo.talk .rb-eye,.as-av.talk .rb-eye{animation:rbtalk .3s infinite}
  @keyframes rbtalk{50%{transform:scaleY(.55)}}
  @keyframes rbbob{50%{transform:translateY(-2.5px)}} @keyframes rbblink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}} @keyframes rbant{50%{fill:#ffd0da}}
  #asst-logo.pulse::before{content:"";position:absolute;inset:-4px;border-radius:16px !important;border:2px solid #5ef2ff;opacity:.7;animation:asstp 2s ease-out infinite}
  #asst-logo.dragging,#asst-panel.dragging{transition:none !important} #asst-logo.dragging{cursor:grabbing;scale:1.1}
  #asst-logo.snap,#asst-panel.snap{transition:translate .32s cubic-bezier(.2,.9,.25,1)}
  @keyframes asstp{to{transform:scale(1.3);opacity:0}}
  #asst-panel{position:fixed;left:0;top:0;z-index:80;width:${PW}px;max-width:calc(100vw - 16px);display:flex;flex-direction:column;background:var(--panel,#0f1318);border:1px solid var(--line2,#2e3641);border-radius:16px;
    box-shadow:0 22px 70px rgba(0,0,0,.72),0 0 0 1px rgba(124,92,255,.12);color:var(--text,#e6e9ed);font-size:13.5px;line-height:1.55;will-change:translate;
    opacity:0;scale:.94;visibility:hidden;pointer-events:none;transition:opacity .16s,scale .18s,visibility .16s}
  #asst-panel.open{opacity:1;scale:1;visibility:visible;pointer-events:auto}
  #asst-panel::after{content:"";position:absolute;top:var(--ty,40px);width:12px;height:12px;background:var(--panel,#0f1318);border:1px solid var(--line2,#2e3641);rotate:45deg;translate:0 -50%;display:none}
  #asst-panel[data-side="l"]::after{display:block;right:-7px;border-width:1px 1px 0 0} #asst-panel[data-side="r"]::after{display:block;left:-7px;border-width:0 0 1px 1px}
  .as-h{display:flex;align-items:center;gap:10px;padding:11px 12px;border-bottom:1px solid var(--line,#232932);cursor:grab;user-select:none;touch-action:none;border-radius:16px 16px 0 0;background:linear-gradient(135deg,rgba(76,141,255,.14),rgba(139,92,246,.12))}
  .as-h:active{cursor:grabbing}
  .as-av{width:36px;height:36px;flex:none;display:grid;place-items:center;filter:drop-shadow(0 2px 6px rgba(94,242,255,.35))}
  .as-h b{font-size:14px} .as-ctx{font-size:11.5px;color:var(--muted,#8a93a0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .as-h button{background:none;border:0;color:var(--muted,#8a93a0);cursor:pointer;font-size:15px;padding:4px 7px;line-height:1;border-radius:8px !important} .as-h button:hover{color:var(--text,#e6e9ed);background:rgba(255,255,255,.07)}
  .as-m{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px;min-height:0}
  .as-b{max-width:92%;padding:9px 12px;white-space:normal;word-wrap:break-word;border-radius:14px}
  .as-b.u{align-self:flex-end;background:linear-gradient(135deg,#4c8dff,#7c5cff);color:#fff;border-bottom-right-radius:4px} .as-b.a{align-self:flex-start;background:var(--panel2,#141920);border:1px solid var(--line,#232932);border-bottom-left-radius:4px}
  .as-b ul{margin:6px 0 2px;padding-left:18px} .as-b p{margin:0 0 6px} .as-b p:last-child{margin:0}
  .as-ref{color:var(--cyan,#4c8dff);font-weight:600;text-decoration:none;border-bottom:1px dotted var(--cyan,#4c8dff)} .as-ref:hover{filter:brightness(1.2)}
  .as-cx{font-size:11px;color:var(--dim,#5b636e);margin-bottom:5px;padding-bottom:4px;border-bottom:1px dashed var(--line,#232932)}
  .as-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
  .as-chip{background:var(--bg,#0b0d10);border:1px solid var(--line2,#2e3641);color:var(--text,#e6e9ed);padding:6px 11px;font-size:12px;cursor:pointer;text-align:left;border-radius:999px !important}
  .as-chip:hover{border-color:#7c5cff;color:#b9a6ff}
  .as-f{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line,#232932)}
  .as-f textarea{flex:1;resize:none;height:38px;max-height:90px;background:var(--bg,#0b0d10);border:1px solid var(--line2,#2e3641);color:var(--text,#e6e9ed);padding:8px 12px;font:inherit;border-radius:12px}
  .as-f textarea:focus{outline:none;border-color:#7c5cff}
  .as-f button{background:linear-gradient(135deg,#4c8dff,#7c5cff);color:#fff;border:0;padding:0 16px;font-weight:700;cursor:pointer;border-radius:12px !important} .as-f button:disabled{opacity:.5;cursor:wait}
  .as-note{font-size:11px;color:var(--dim,#5b636e);padding:0 14px 10px}
  .as-dots span{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--muted,#8a93a0);margin-right:4px;animation:asd 1s infinite} .as-dots span:nth-child(2){animation-delay:.15s} .as-dots span:nth-child(3){animation-delay:.3s}
  @keyframes asd{50%{opacity:.25}}
  @media (max-width:560px){#asst-panel{width:calc(100vw - 16px)} #asst-logo.hide{display:none}}
  @media print{#asst-logo,#asst-panel{display:none !important}}`;
  document.head.appendChild(css);

  const logo = document.createElement('button');
  logo.id = 'asst-logo'; logo.type = 'button'; logo.title = 'Asisten AI::Klik untuk bertanya. Tarik untuk memindahkan; lepas di dekat sudut area konten agar menempel.'; logo.innerHTML = ROBOT(46, 'l');
  logo.setAttribute('aria-label', 'Asisten AI');
  const panel = document.createElement('div');
  panel.id = 'asst-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Asisten AI');
  panel.innerHTML = '<div class="as-h" id="as-h"><span class="as-av">' + ROBOT(32, 'h') + '</span><div style="flex:1;min-width:0"><b>Asisten AI</b><div class="as-ctx" id="as-ctx"></div></div>'
    + '<button type="button" id="as-tour" title="Tur fitur::Ulangi tur singkat yang dipandu suara." aria-label="Tur fitur">?</button><button type="button" id="as-voice" aria-label="Suara"></button><button type="button" id="as-clear" title="Percakapan baru::Hapus riwayat chat dan mulai dari awal.">↺</button><button type="button" id="as-min" title="Tutup::Tutup jendela chat. Logo AI tetap di layar." aria-label="Tutup">✕</button></div>'
    + '<div class="as-m" id="as-m"></div>'
    + '<div class="as-f"><textarea id="as-in" placeholder="Tanya tentang portofolio, perusahaan, atau berita…" rows="1"></textarea><button type="button" id="as-send">Kirim</button></div>'
    + '<div class="as-note">Jawaban dari data tersimpan, bukan keputusan kredit. Periksa rujukan.</div>';
  document.body.append(panel, logo);
  logo.classList.add('pulse');
  const $ = (id) => panel.querySelector('#' + id);
  window.msRobot = ROBOT;                                           // dipakai tur (tour.js)
  const SPK_ON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
  const SPK_OFF = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';
  const paintVoice = () => {
    const b = $('as-voice'); if (!b) return;
    const v = window.msVoice;
    if (!v || !v.supported) { b.hidden = true; return; }
    b.innerHTML = v.enabled ? SPK_ON : SPK_OFF;
    b.title = v.enabled ? 'Suara aktif::Jawaban dibacakan dengan suara robot. Klik untuk membisukan.' : 'Suara mati::Klik untuk menyalakan suara robot.';
  };
  window.addEventListener('ms-voice-pref', paintVoice);
  window.addEventListener('ms-voice', (e) => { const on = !!e.detail?.speaking; logo.classList.toggle('talk', on); panel.querySelector('.as-av')?.classList.toggle('talk', on); });

  /* ---------- posisi: logo = jangkar, panel mengikuti ---------- */
  // Area bergerak = area konten utama: di bawah navbar atas dan di kanan sidebar (bila tampil). Dihitung ulang setiap render.
  let B = { l: 0, t: 0 };
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
  const clampX = (x) => Math.min(Math.max(minX(), x), maxX()), clampY = (y) => Math.min(Math.max(minY(), y), maxY());
  let pos = LS('ms.asst.pos') || { corner: 'br' };            // {corner:'tl'|'tr'|'bl'|'br'} atau {x,y} bebas
  const coords = () => (pos.corner
    ? [pos.corner.includes('r') ? maxX() : minX(), pos.corner.includes('b') ? maxY() : minY()]
    : [clampX(pos.x ?? maxX()), clampY(pos.y ?? maxY())]);
  const isOpen = () => panel.classList.contains('open');
  const small = () => innerWidth <= 560;

  function layoutPanel(x, y) {
    if (small()) {
      const h = Math.round(Math.min(innerHeight * 0.72, 560));
      panel.style.height = h + 'px'; panel.dataset.side = '';
      panel.style.translate = '8px ' + (innerHeight - h - 8) + 'px'; panel.style.transformOrigin = 'bottom center';
      return;
    }
    const h = Math.min(520, innerHeight - B.t - 16);
    panel.style.height = h + 'px';
    const cx = x + S / 2, cy = y + S / 2;
    let px, py, side = '';
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

  // Tarik logo atau header jendela (keduanya menggerakkan logo; jendela ikut). Klik tanpa tarik = onTap.
  function bindDrag(handle, onTap) {
    let sx, sy, ox, oy, moved = false, down = false, pid = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      if (handle !== logo && e.target.closest('button')) return;
      down = true; moved = false; sx = e.clientX; sy = e.clientY; [ox, oy] = coords(); pid = e.pointerId;
      handle.setPointerCapture?.(pid);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved) {
        if (Math.hypot(dx, dy) < 5) return;
        moved = true; logo.classList.add('dragging'); panel.classList.add('dragging'); logo.classList.remove('snap'); panel.classList.remove('snap');
        document.documentElement.style.userSelect = 'none';
      }
      pos = { x: clampX(ox + dx), y: clampY(oy + dy) };
      schedule();
    });
    const end = (cancel) => {
      if (!down) return; down = false;
      try { handle.releasePointerCapture?.(pid); } catch { /* sudah dilepas */ }
      document.documentElement.style.userSelect = '';
      logo.classList.remove('dragging'); panel.classList.remove('dragging');
      if (moved) { snapToCorner(); LS('ms.asst.pos', pos); }
      else if (!cancel && onTap) onTap();
    };
    handle.addEventListener('pointerup', () => end(false));
    handle.addEventListener('pointercancel', () => end(true));
  }
  // Dilepas dekat sudut (di kedua sumbu) -> tertarik ke sudut itu dengan animasi
  function snapToCorner() {
    const [x, y] = coords();
    bounds();
    const dxe = Math.min(x - minX(), maxX() - x), dye = Math.min(y - minY(), maxY() - y);
    if (dxe <= SNAP && dye <= SNAP) pos = { corner: (y < (minY() + maxY()) / 2 ? 't' : 'b') + (x < (minX() + maxX()) / 2 ? 'l' : 'r') };
    logo.classList.add('snap'); panel.classList.add('snap');
    render();
    clearTimeout(snapToCorner.t); snapToCorner.t = setTimeout(() => { logo.classList.remove('snap'); panel.classList.remove('snap'); }, 400);
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
    return (html + (list ? '</ul>' : '')).replace(/`/g, '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[([^\]]{1,80})\]\((\/help[.]html(?:#[a-z0-9_-]{1,40})?)\)/g, '<a class="as-ref" href="$2" target="_blank" rel="noopener">$1</a>').replace(/\[berita #(\d+)\]/g, '<a class="as-ref" href="#" data-nid="$1" title="Buka berita #$1">berita #$1</a>');
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
  function syncContext() {
    const ctx = currentContext();
    $('as-ctx').textContent = ctx.label;
    const key = ctxKey(ctx);
    if (key !== lastCtxKey) {
      lastCtxKey = key; LS('ms.asst.ctx', key);
      if (!msgs.length) greet();
      draw();
    }
  }
  function greet() {
    msgs.push({ role: 'assistant', content: 'Halo! Saya asisten analisis risiko. Saya bisa membantu membaca portofolio, profil risiko, temuan deed discovery, dan detail berita dari data yang sudah tersimpan.\n\nPilih pertanyaan di bawah atau ketik sendiri. Tarik logo saya ke sudut mana pun supaya tidak menutupi layar.' });
  }

  async function ask(text, ctxOverride) {
    text = String(text || '').trim();
    if (!text || busy) return;
    openPanel();
    const ctx = ctxOverride || currentContext();
    const lastAns = [...msgs].reverse().find((m) => m.role === 'assistant' && m.cx);
    const prev = lastAns && ctxKey(lastAns.cx) !== ctxKey(ctx) ? lastAns.cx : null;      // halaman sudah berganti sejak jawaban terakhir
    window.msVoice?.stop();                                       // pertanyaan baru: hentikan suara yang masih berjalan
    msgs.push({ role: 'user', content: text, ck: ctxKey(ctx), cx: { type: ctx.type, companyId: ctx.companyId, newsId: ctx.newsId } });
    busy = true; $('as-send').disabled = true; draw();      // rekomendasi hilang saat pertanyaan dikirim; yang baru muncul bersama jawaban
    try {
      const history = msgs.filter((m) => !m.sep).slice(-7).map((m) => ({ role: m.role, content: m.content, cx: m.cx }));      // tiap giliran membawa halaman tempat ia terjadi (memori percakapan)
      const r = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history, context: { type: ctx.type, companyId: ctx.companyId, newsId: ctx.newsId }, prev }) });
      const raw = await r.text();
      let j = null;
      try { j = JSON.parse(raw); } catch { /* bukan JSON */ }
      if (!j) throw new Error(r.status === 404 || /^\s*<!doctype|<html/i.test(raw)
        ? 'server ini belum memuat fitur asisten (kemungkinan belum di-restart). Restart server, lalu muat ulang halaman.'
        : 'balasan server tidak dapat dibaca (HTTP ' + r.status + ')');
      if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
      msgs.push({ role: 'assistant', content: j.answer, ctx: ctx.label, cx: { type: ctx.type, companyId: ctx.companyId, newsId: ctx.newsId } });
      scrollMode = 'answer';
      window.msVoice?.speak(j.answer);                              // jawaban dibacakan dengan suara robot (bisa dibisukan)
    } catch (e) {
      msgs.push({ role: 'assistant', content: 'Maaf, gagal menjawab: ' + e.message });
    }
    busy = false; $('as-send').disabled = false; draw();
  }

  /* ---------- buka / tutup (logo tetap ada) ---------- */
  function openPanel() {
    if (isOpen()) return;
    logo.classList.remove('pulse');
    panel.classList.add('open'); LS('ms.asst.open', true);
    render(); syncContext();
    if (!small()) $('as-in').focus({ preventScroll: true });
  }
  function closePanel() { panel.classList.remove('open'); LS('ms.asst.open', false); window.msVoice?.stop(); render(); }
  window.assistantClose = closePanel;

  bindDrag(logo, () => (isOpen() ? closePanel() : openPanel()));
  bindDrag($('as-h'));
  $('as-min').onclick = closePanel;
  $('as-voice').onclick = () => { const v = window.msVoice; if (v) v.setEnabled(!v.enabled); };
  $('as-tour').onclick = () => window.msStartTour?.();
  paintVoice();
  $('as-clear').onclick = () => { msgs = []; lastCtxKey = ''; LS('ms.asst.ctx', ''); syncContext(); };
  $('as-send').onclick = () => { const v = $('as-in').value; $('as-in').value = ''; ask(v); };
  $('as-in').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('as-send').click(); } });
  addEventListener('hashchange', () => isOpen() && syncContext());
  addEventListener('ms-context', () => isOpen() && syncContext());
  addEventListener('resize', schedule);

  // API untuk komponen lain: tombol AI di modal berita membuka jendela ini (di luar modal) sesuai konteks berita; tanpa mengirim pertanyaan otomatis.
  window.assistantOpen = () => { openPanel(); syncContext(); $('as-in').focus({ preventScroll: true }); };
  window.assistantAsk = (text, ctx) => { openPanel(); syncContext(); ask(text, ctx); };

  // Tampil sejak halaman dibuka: jendela terbuka di kunjungan pertama sesi ini; setelahnya mengikuti pilihan terakhir. Logo selalu terlihat.
  render();
  const first = SS('ms.asst.seen') == null;
  SS('ms.asst.seen', true);
  if (LS('ms.tour') != null && LS('ms.asst.open')) setTimeout(openPanel, 200);      // kunjungan pertama disapa tur (tour.js), bukan panel chat
})();
