// Tooltip bergaya untuk seluruh aplikasi: menggantikan tooltip bawaan browser (atribut title) dengan kartu kecil yang rapi.
// Tetap tulis title="..." atau data-tip="..." seperti biasa. Format "Judul::penjelasan" menampilkan judul tebal di atas penjelasan.
// Muncul saat hover atau fokus keyboard, menyesuaikan posisi agar tidak keluar layar, dan hilang saat scroll/klik. CSS ada di styles/widgets.css.

import { esc } from './format';
/** Pasang tooltip global. Mengembalikan fungsi pembersih. */
export function initTooltip(): () => void {
  const tip = document.createElement('div');
  tip.id = 'ms-tip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);

  let cur: Element | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const textOf = (el: HTMLElement) => {
    if (el.hasAttribute('title')) { el.dataset.tip = el.getAttribute('title') || ''; el.removeAttribute('title'); }   // ambil alih tooltip bawaan
    return el.dataset.tip || '';
  };
  const hide = () => { clearTimeout(timer); cur = null; tip.classList.remove('on'); };
  function show(el: HTMLElement) {
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
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    tip.style.setProperty('--ax', Math.min(Math.max(16, r.left + r.width / 2 - x), w - 16) + 'px');
    tip.classList.add('on');
  }
  const target = (n: EventTarget | null) => (n instanceof Element ? (n.closest('[title],[data-tip]') as HTMLElement | null) : null);

  const onOver = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const el = target(e.target);
    if (!el || el === cur) return;
    hide(); textOf(el);
    timer = setTimeout(() => show(el), 140);
  };
  const onOut = (e: PointerEvent) => { const el = target(e.target); if (el && (!e.relatedTarget || !el.contains(e.relatedTarget as Node))) hide(); };
  const onFocusIn = (e: FocusEvent) => { const el = target(e.target); if (el) show(el); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };

  document.addEventListener('pointerover', onOver);
  document.addEventListener('pointerout', onOut);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', hide);
  addEventListener('scroll', hide, true);
  addEventListener('pointerdown', hide, true);
  addEventListener('keydown', onKey);
  return () => {
    clearTimeout(timer);
    document.removeEventListener('pointerover', onOver);
    document.removeEventListener('pointerout', onOut);
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('focusout', hide);
    removeEventListener('scroll', hide, true);
    removeEventListener('pointerdown', hide, true);
    removeEventListener('keydown', onKey);
    tip.remove();
  };
}
