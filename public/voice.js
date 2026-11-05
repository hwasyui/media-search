/* Suara robot untuk asisten AI dan tur: memakai Web Speech API bawaan browser (tanpa server, tanpa biaya, tanpa mengirim teks ke luar).
   window.msVoice.speak(teks) membacakan teks; .stop(); .enabled / .setEnabled(bool) = bisukan (tersimpan). Suara dipilih bahasa Indonesia bila tersedia
   (nada direndahkan agar terdengar seperti robot); bila tidak ada, memakai suara bawaan. Peristiwa 'ms-voice' {speaking} dipakai untuk menganimasikan robot. */
(() => {
  'use strict';
  const LS = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } };
  const synth = window.speechSynthesis;
  const supported = !!synth && 'SpeechSynthesisUtterance' in window;
  let token = 0, speaking = false;

  const emit = (s) => { if (speaking === s) return; speaking = s; window.dispatchEvent(new CustomEvent('ms-voice', { detail: { speaking: s } })); };

  // Teks layar -> teks ucapan: buang markdown, tautan, nomor rujukan; eja singkatan agar terdengar jelas
  function clean(t) {
    return String(t || '')
      .replace(/https?:\/\/\S+/g, ' ').replace(/\[\d+\]/g, ' ').replace(/[*_`#>]+/g, ' ')
      .replace(/^\s*[-•]\s+/gm, ', ').replace(/→/g, ' lalu ').replace(/\s*\n+\s*/g, '. ')
      .replace(/\bAI\b/g, 'A I').replace(/\bFAP\b/g, 'F A P').replace(/\bUBO\b/g, 'U B O').replace(/\bPSP\b/g, 'P S P').replace(/\bDER\b/g, 'D E R').replace(/\bOJK\b/g, 'O J K')
      .replace(/\bRp\.?\s?/g, 'rupiah ').replace(/%/g, ' persen').replace(/&/g, ' dan ').replace(/\s{2,}/g, ' ').replace(/\.\s*\./g, '.').trim().slice(0, 1400);
  }
  // Potong per kalimat (~180 karakter): ucapan panjang di beberapa browser berhenti sendiri bila tidak dipotong
  function chunks(text) {
    const parts = text.split(/(?<=[.!?;:])\s+/), out = [];
    let cur = '';
    for (const p of parts) { if ((cur + ' ' + p).length > 180 && cur) { out.push(cur); cur = p; } else cur = cur ? cur + ' ' + p : p; }
    if (cur) out.push(cur);
    return out;
  }
  function pickVoice() {
    const vs = synth.getVoices();
    return vs.find((v) => /^id[-_]/i.test(v.lang) && /google|online|natural/i.test(v.name)) || vs.find((v) => /^id[-_]/i.test(v.lang)) || vs.find((v) => /^ms[-_]/i.test(v.lang)) || null;
  }

  const api = {
    supported,
    get enabled() { return LS('ms.voice') !== false; },
    setEnabled(on) { LS('ms.voice', !!on); if (!on) api.stop(); window.dispatchEvent(new Event('ms-voice-pref')); },
    stop() { token++; if (supported) synth.cancel(); emit(false); },
    speak(text) {
      if (!supported || !api.enabled) return;
      const list = chunks(clean(text));
      if (!list.length) return;
      synth.cancel();
      const my = ++token, voice = pickVoice();
      let i = 0;
      const next = () => {
        if (my !== token) return;
        if (i >= list.length) { emit(false); return; }
        const u = new SpeechSynthesisUtterance(list[i++]);
        u.lang = voice?.lang || 'id-ID'; if (voice) u.voice = voice;
        u.rate = 0.98; u.pitch = 0.55; u.volume = 1;            // nada rendah = kesan robot
        u.onstart = () => { if (my === token) emit(true); };
        u.onend = next; u.onerror = () => { if (my === token) emit(false); };
        synth.speak(u);
      };
      next();
    },
  };
  window.msVoice = api;
  addEventListener('beforeunload', () => { if (supported) synth.cancel(); });
  if (supported) synth.getVoices();                              // memicu pemuatan daftar suara
})();
