// Penyimpanan peramban yang aman dari galat (mode privat / diblokir): LS = localStorage, SS = sessionStorage, bernilai JSON.
function make(get: () => Storage) {
  return {
    get<T = unknown>(k: string): T | null { try { const v = get().getItem(k); return v == null ? null : (JSON.parse(v) as T); } catch { return null; } },
    set(k: string, v: unknown) { try { get().setItem(k, JSON.stringify(v)); } catch { /* abaikan */ } },
  };
}
export const LS = make(() => localStorage);
export const SS = make(() => sessionStorage);
