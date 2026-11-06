// Bentuk data dari API (sengaja longgar: server mengirim banyak kolom opsional). Kolom yang dipakai tampilan didaftar eksplisit.
export type Layer = 'relevan' | 'cleaned' | 'mentah';

export interface RiskTag { cat: string; severity: number; hit?: string }
export interface AlsoCo { id: string; l: string; i?: string; r?: string }

export interface NewsRow {
  id: number;
  title: string;
  url?: string; article_url?: string | null; image_url?: string | null; image_checked?: number | boolean;
  snippet?: string; ai_summary?: string;
  source_name?: string; source_domain?: string; source_key?: string;
  published_at: string;
  company_id: string; company_name: string; company_ticker?: string;
  ai_status?: string; company_role?: string | null; impact?: string | null; impact_reason?: string | null;
  risk_tags?: RiskTag[]; credibility_tier?: string; also_n?: number; also_cos?: AlsoCo[];
  platform?: string; content_kind?: string; related?: number | null;
  [k: string]: any;
}

export interface Company {
  id: string; name: string; ticker?: string | null; type: 'public' | 'private' | string; sector?: string | null;
  aliases?: string[]; extraQueries?: string[]; stakeholders?: { name: string; role?: string }[]; lastCrawlAt?: string | null;
  risk?: { rating: string; score?: number; coverage?: Record<string, any> } | null;
  stats?: { total: number; official: number; rumor: number; positive: number; risk: number; latest?: string | null };
  [k: string]: any;
}

export interface FeedState {
  sort: string; q: string; days: string; platform: string; impact: string; riskCat: string; riskMin: string; ai: string; source: string; company: string; _adv: boolean;
}
export const newFeedState = (): FeedState => ({ sort: 'mix', q: '', days: '7', platform: '', impact: '', riskCat: '', riskMin: '', ai: '', source: '', company: '', _adv: false });
