import { json } from '@/lib/server/http';
import { SOURCES, MODIFIERS, PERIOD } from '@/news/search.js';
import { geminiKeys, groqKeys, MAX_ITEMS as AI_MAX_ITEMS } from '@/ai/classify.js';
import { listCompanies } from '@/db/store.js';

export async function GET() {
  const companies = await listCompanies();
  return json({
    companies,
    sources: Object.entries(SOURCES).map(([key, v]: [string, any]) => ({ key, label: v.label, disabled: v.disabled })),
    modifiers: Object.entries(MODIFIERS).map(([key, v]: [string, any]) => ({ key, label: v.label })),
    period: PERIOD,
    groqReady: groqKeys().length > 0 || geminiKeys().length > 0,
    geminiKeyCount: geminiKeys().length,
    groqKeyCount: groqKeys().length,
    aiMaxItems: AI_MAX_ITEMS,
  });
}
