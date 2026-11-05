/* Tooltip bergaya untuk seluruh portal: menggantikan tooltip bawaan browser (atribut title) dengan kartu kecil yang rapi.
   Cara pakai: tetap tulis title="..." atau data-tip="..." seperti biasa. Format "Judul::penjelasan" menampilkan judul tebal di atas penjelasan.
   Muncul saat hover atau fokus keyboard, menyesuaikan posisi agar tidak keluar layar, dan hilang saat scroll/klik. */
(() => {
  'use strict';
  if (window.__msTip) return; window.__msTip = true;      // aman dimuat dua kali (portal memuatnya sendiri; halaman lain lewat shell.js)
  const css = document.createElement('style');
  css.textContent = `
  #ms-tip{position:fixed;left:0;top:0;z-index:200;max-width:300px;padding:10px 12px;border-radius:10px;background:#171d27;color:#e6e9ed;border:1px solid #2e3a4b;box-shadow:0 12px 36px rgba(0,0,0,.6);font:12.5px/1.55 Inter,system-ui,sans-serif;pointer-events:none;opacity:0;translate:0 4px;transition:opacity .12s,translate .12s;white-space:normal}
  #ms-tip.on{opacity:1;translate:0 0}
  #ms-tip b{display:block;font-size:12.5px;margin-bottom:3px;color:#fff}
  #ms-tip span{color:#b4bcc8;display:block;white-space:pre-line}
  #ms-tip::after{content:"";position:absolute;left:var(--ax,50%);width:9px;height:9px;background:#171d27;border:1px solid #2e3a4b;border-width:0 1px 1px 0;rotate:45deg;translate:-50% 0;bottom:-5px}
  #ms-tip.below::after{bottom:auto;top:-5px;border-width:1px 0 0 1px}
  @media print{#ms-tip{display:none !important}}`;
  document.head.appendChild(css);
  const tip = document.createElement('div');
  tip.id = 'ms-tip'; tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  let cur = null, timer = 0;
  const textOf = (el) => {
    if (el.hasAttribute('title')) { el.dataset.tip = el.getAttribute('title'); el.removeAttribute('title'); }   // ambil alih tooltip bawaan
    return el.dataset.tip || '';
  };
  const hide = () => { clearTimeout(timer); cur = null; tip.classList.remove('on'); };
  function show(el) {
    const t = textOf(el).trim();
    if (!t) return;
    cur = el;
    const [head, ...rest] = t.includes('::') ? t.split('::') : [null, t];
    tip.innerHTML = (head ? '<b>' + esc(head.trim()) + '</b>' : '') + '<span>' + esc(rest.join('::').trim()) + '</span>';
    tip.classList.remove('below');
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, gap = 10;
    let x = r.left + r.width / 2 - w / 2;
    x = Math.min(Math.max(8, x), innerWidth - w - 8);
    let y = r.top - h - gap;
    if (y < 8) { y = r.bottom + gap; tip.classList.add('below'); }
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
    tip.style.setProperty('--ax', Math.min(Math.max(16, r.left + r.width / 2 - x), w - 16) + 'px');
    tip.classList.add('on');
  }
  const target = (n) => (n instanceof Element ? n.closest('[title],[data-tip]') : null);
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = target(e.target);
    if (!el || el === cur) return;
    hide(); textOf(el);
    timer = setTimeout(() => show(el), 140);
  });
  document.addEventListener('pointerout', (e) => { const el = target(e.target); if (el && (!e.relatedTarget || !el.contains(e.relatedTarget))) hide(); });
  document.addEventListener('focusin', (e) => { const el = target(e.target); if (el) show(el); });
  document.addEventListener('focusout', hide);
  addEventListener('scroll', hide, true);
  addEventListener('pointerdown', hide, true);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
})();
