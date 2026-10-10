// localStorage envuelto en try/catch (modo privado, cuota llena, SSR, etc.).

function ls(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const safeStorage = {
  getJSON<T>(key: string): T | null {
    try {
      const raw = ls()?.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  setJSON(key: string, value: unknown): boolean {
    try {
      const s = ls();
      if (!s) return false;
      s.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string): void {
    try {
      ls()?.removeItem(key);
    } catch {}
  },
};
