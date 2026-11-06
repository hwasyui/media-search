// Agent loop dengan pemanggilan alat (function calling) untuk Gemini dan Groq. Model hanya MEMINTA alat; kode kita yang menjalankannya (lihat execTool di assistant.js).
// Urutan: Gemini (rantai model: bila satu model sibuk/habis, model berikutnya; key bergantian saat 429), lalu Groq. Tiap kandidat menjalankan loop dari awal
// dengan format kawat miliknya sendiri; hasil alat dimemo oleh pemanggil (execTool) sehingga mengulang dari awal tidak mengulang query.
import { geminiKeys, geminiModels, groqKeys } from './classify.js';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const cool = new Map();                                   // `${provider}|${model}|${key}` -> waktu boleh dicoba lagi
const mask = (k) => '...' + String(k).slice(-4);
const short = (e) => String(e?.message || e).replace(/\s+/g, ' ').slice(0, 140);

const httpErr = (provider, model, status, body) => Object.assign(new Error(`${provider} HTTP ${status} (${model}): ${String(body).replace(/\s+/g, ' ').slice(0, 160)}`), { status });

// JSON Schema dari MCP -> subset yang diterima Gemini
function cleanSchema(s) {
  if (!s || typeof s !== 'object') return undefined;
  const out = {};
  const t = Array.isArray(s.type) ? s.type.find((x) => x !== 'null') : s.type;
  if (t) out.type = String(t);
  if (s.description) out.description = String(s.description).slice(0, 600);
  if (Array.isArray(s.enum)) out.enum = s.enum;
  if (s.properties) { out.properties = {}; for (const [k, v] of Object.entries(s.properties)) out.properties[k] = cleanSchema(v) || { type: 'string' }; }
  if (Array.isArray(s.required) && s.required.length) out.required = s.required;
  if (s.items) out.items = cleanSchema(s.items);
  return out;
}
const hasParams = (t) => Object.keys(t.inputSchema?.properties || {}).length > 0;

/* ---------- Gemini ---------- */
function geminiContents(transcript) {
  return transcript.map((m) => {
    if (m.role === 'user') return { role: 'user', parts: [{ text: m.text }] };
    if (m.role === 'assistant') return { role: 'model', parts: [{ text: m.text }] };
    if (m.role === 'model_raw') return m.content;                                         // balasan model apa adanya (membawa thoughtSignature bila ada)
    return { role: 'user', parts: m.results.map((r) => ({ functionResponse: { name: r.name, response: { output: r.text } } })) };
  });
}
async function geminiOnce({ key, model, system, transcript, tools, final, signal }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: geminiContents(transcript),
    generationConfig: { temperature: 0.2, maxOutputTokens: 1800 },
    tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description.slice(0, 1200), ...(hasParams(t) ? { parameters: cleanSchema(t.inputSchema) } : {}) })) }],
    toolConfig: { functionCallingConfig: { mode: final ? 'NONE' : 'AUTO' } },
  };
  const res = await fetch(`${GEMINI}/${model}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([AbortSignal.timeout(60000), ...(signal ? [signal] : [])]) });
  if (!res.ok) throw httpErr('Gemini', model, res.status, await res.text());
  const j = await res.json();
  const cand = j.candidates?.[0];
  const parts = cand?.content?.parts || [];
  const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
  const calls = parts.filter((p) => p.functionCall).map((p, i) => ({ id: p.functionCall.id || `${p.functionCall.name}#${i}`, name: p.functionCall.name, args: p.functionCall.args || {} }));
  if (!text && !calls.length) throw Object.assign(new Error(`Gemini kosong (${model}, ${cand?.finishReason || j.promptFeedback?.blockReason || '-'})`), { status: 503 });
  return { text, calls, raw: { role: 'model_raw', content: cand.content } };
}

/* ---------- Groq (format OpenAI) ---------- */
function groqMessages(system, transcript) {
  const out = [{ role: 'system', content: system }];
  for (const m of transcript) {
    if (m.role === 'user') out.push({ role: 'user', content: m.text });
    else if (m.role === 'assistant') out.push({ role: 'assistant', content: m.text });
    else if (m.role === 'model_raw') out.push(m.message);
    else for (const r of m.results) out.push({ role: 'tool', tool_call_id: r.id, content: r.text });
  }
  return out;
}
async function groqOnce({ key, model, system, transcript, tools, final, signal }) {
  const body = {
    model, messages: groqMessages(system, transcript), temperature: 0.2, max_tokens: 1800,
    tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description.slice(0, 1200), parameters: hasParams(t) ? cleanSchema(t.inputSchema) : { type: 'object', properties: {} } } })),
    tool_choice: final ? 'none' : 'auto',
    ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
  };
  const res = await fetch(GROQ_URL, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([AbortSignal.timeout(60000), ...(signal ? [signal] : [])]) });
  if (!res.ok) throw httpErr('Groq', model, res.status, await res.text());
  const j = await res.json();
  const msg = j.choices?.[0]?.message;
  if (!msg) throw Object.assign(new Error(`Groq kosong (${model})`), { status: 503 });
  const calls = (msg.tool_calls || []).map((c) => { let args = {}; try { args = JSON.parse(c.function?.arguments || '{}'); } catch { /* argumen rusak: kosong */ } return { id: c.id, name: c.function?.name, args }; });
  const text = msg.content || '';
  if (!text && !calls.length) throw Object.assign(new Error(`Groq kosong (${model})`), { status: 503 });
  return { text, calls, raw: { role: 'model_raw', message: { role: 'assistant', content: msg.content || null, ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) } } };
}

/* ---------- loop ---------- */
async function loop(cand, { system, history, tools, execTool, maxSteps, signal }) {
  const once = cand.provider === 'gemini' ? geminiOnce : groqOnce;
  const transcript = [...history];
  const used = [];
  for (let step = 0; step <= maxSteps; step++) {
    const final = step === maxSteps;                                    // langkah terakhir: tanpa alat, paksa jawaban dari data yang ada
    const r = await once({ ...cand, system, transcript, tools, final, signal });
    if (final || !r.calls.length) {
      if (!r.text.trim()) throw Object.assign(new Error('jawaban kosong'), { status: 503 });
      return { text: r.text, steps: step, tools: used };
    }
    transcript.push(r.raw);
    const results = await Promise.all(r.calls.map(async (c, i) => {
      used.push(c.name);
      // semua panggilan HARUS dijawab (syarat format); yang melebihi batas per langkah ditolak dengan pesan
      const text = i < 4 ? await execTool(c.name, c.args) : 'Dilewati: terlalu banyak panggilan alat sekaligus. Panggil lebih sedikit.';
      return { id: c.id, name: c.name, text };
    }));
    transcript.push({ role: 'tool_results', results });
  }
  throw new Error('loop tidak selesai');
}

/** Jalankan agent. history: [{role:'user'|'assistant', text}] (pesan terakhir = pertanyaan). tools: dari MCP. execTool(name,args) -> string. */
export async function runAgent({ system, history, tools, execTool, maxSteps = 5, signal }) {
  const tried = [];
  const attempt = async (cand) => {
    const id = `${cand.provider}|${cand.model}|${cand.key}`;
    if ((cool.get(id) || 0) > Date.now()) return null;
    try { const r = await loop(cand, { system, history, tools, execTool, maxSteps, signal }); return { ...r, provider: cand.provider, model: cand.model }; }
    catch (e) {
      if (e.name === 'AbortError' && signal?.aborted) throw e;
      tried.push(`${cand.provider}/${cand.model}${cand.provider === 'gemini' ? '' : ''} ${mask(cand.key)}: ${short(e)}`);
      if (e.status === 429 || e.status === 401 || e.status === 403) cool.set(id, Date.now() + 90_000);        // key/model ini istirahat; kandidat lain dicoba
      return { skip: true, status: e.status };
    }
  };
  for (const model of geminiModels()) {
    for (const key of geminiKeys()) {
      const r = await attempt({ provider: 'gemini', model, key });
      if (r && !r.skip) return r;
      if (r?.skip && !(r.status === 429 || r.status === 401 || r.status === 403)) break;       // masalah model (5xx dll.): model berikutnya
    }
  }
  const gm = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  for (const key of groqKeys()) {
    const r = await attempt({ provider: 'groq', model: gm, key });
    if (r && !r.skip) return r;
  }
  throw new Error('Semua penyedia AI gagal: ' + (tried.slice(-4).join(' | ') || 'tidak ada API key AI di .env'));
}
