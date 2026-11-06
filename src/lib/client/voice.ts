// Suara asisten AI dan tur: memakai Web Speech API bawaan browser (tanpa server, tanpa biaya, tanpa mengirim teks ke luar).
// voice.speak(teks) membacakan teks; .stop(); .enabled / .setEnabled(bool) = bisukan (tersimpan). Suara dipilih bahasa Indonesia bila tersedia
// ("Natural"/online lebih dulu karena paling mulus; nada normal, tanpa efek yang membuat suara pecah); bila tidak ada, memakai suara bawaan.
// Peristiwa 'ms-voice' {speaking} dipakai untuk menganimasikan robot; 'ms-voice-pref' saat pilihan bisu berubah.
import { LS } from './storage';

let token = 0;
let speaking = false;
const synth = (): SpeechSynthesis | null => (typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window ? window.speechSynthesis : null);

const emit = (s: boolean) => {
  if (speaking === s) return;
  speaking = s;
  window.dispatchEvent(new CustomEvent('ms-voice', { detail: { speaking: s } }));
};

// Teks layar -> teks ucapan: buang markdown, tautan, nomor rujukan; eja singkatan agar terdengar jelas
function clean(t: string) {
  return String(t || '')
    .replace(/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/gm, '').replace(/\s*\|\s*/g, ', ')      // tabel: buang baris pemisah, pembatas kolom dibaca sebagai jeda
    .replace(/https?:\/\/\S+/g, ' ').replace(/\[\d+\]/g, ' ').replace(/[*_`#>]+/g, ' ')
    .replace(/^\s*[-•]\s+/gm, ', ').replace(/→/g, ' lalu ').replace(/\s*\n+\s*/g, '. ')
    .replace(/\bAI\b/g, 'A I').replace(/\bFAP\b/g, 'F A P').replace(/\bUBO\b/g, 'U B O').replace(/\bPSP\b/g, 'P S P').replace(/\bDER\b/g, 'D E R').replace(/\bOJK\b/g, 'O J K')
    .replace(/\bRp\.?\s?/g, 'rupiah ').replace(/%/g, ' persen').replace(/&/g, ' dan ').replace(/\s{2,}/g, ' ').replace(/\.\s*\./g, '.').trim().slice(0, 1400);
}
// Potong per kalimat (~180 karakter): ucapan panjang di beberapa browser berhenti sendiri bila tidak dipotong
function chunks(text: string) {
  const parts = text.split(/(?<=[.!?;:])\s+/), out: string[] = [];
  let cur = '';
  for (const p of parts) { if ((cur + ' ' + p).length > 180 && cur) { out.push(cur); cur = p; } else cur = cur ? cur + ' ' + p : p; }
  if (cur) out.push(cur);
  return out;
}
function pickVoice(s: SpeechSynthesis) {
  const vs = s.getVoices();
  return vs.find((v) => /^id[-_]/i.test(v.lang) && /natural/i.test(v.name)) || vs.find((v) => /^id[-_]/i.test(v.lang) && /google|online/i.test(v.name)) || vs.find((v) => /^id[-_]/i.test(v.lang)) || vs.find((v) => /^ms[-_]/i.test(v.lang)) || null;
}

export const voice = {
  get supported() { return synth() !== null; },
  get enabled() { return LS.get<boolean>('ms.voice') !== false; },
  setEnabled(on: boolean) { LS.set('ms.voice', !!on); if (!on) voice.stop(); window.dispatchEvent(new Event('ms-voice-pref')); },
  stop() { token++; synth()?.cancel(); emit(false); },
  speak(text: string) {
    const s = synth();
    if (!s || !voice.enabled) return;
    const list = chunks(clean(text));
    if (!list.length) return;
    s.cancel();
    const my = ++token, v = pickVoice(s);
    let i = 0;
    const next = () => {
      if (my !== token) return;
      if (i >= list.length) { emit(false); return; }
      const u = new SpeechSynthesisUtterance(list[i++]);
      u.lang = v?.lang || 'id-ID'; if (v) u.voice = v;
      u.rate = 1; u.pitch = 1; u.volume = 1;                  // nada & kecepatan normal: nada rendah (<0.8) membuat suara pecah "brbrbr"
      u.onstart = () => { if (my === token) emit(true); };
      u.onend = next; u.onerror = () => { if (my === token) emit(false); };
      s.speak(u);
    };
    next();
  },
};

/** Picu pemuatan daftar suara dan hentikan ucapan saat tab ditutup. Mengembalikan fungsi pembersih. */
export function initVoice(): () => void {
  const onUnload = () => synth()?.cancel();
  addEventListener('beforeunload', onUnload);
  synth()?.getVoices();
  return () => removeEventListener('beforeunload', onUnload);
}
