// Capa de datos. Hoy guarda en localStorage (con try/catch); la interfaz está
// pensada para cambiar a Supabase o Vercel Postgres sin tocar la UI:
// implementá `JournalRepository` con llamadas a la base y reemplazá `localRepository`.
import { emptyJournal, type JournalData } from '../journal/types';
import { safeStorage } from './safe-storage';

export interface JournalRepository {
  load(): Promise<JournalData>;
  save(data: JournalData): Promise<void>;
}

const KEY = 'cpa.journal.v1';

export const localRepository: JournalRepository = {
  async load() {
    const raw = safeStorage.getJSON<unknown>(KEY);
    if (!raw) return emptyJournal();
    try {
      return parseJournal(raw);
    } catch {
      return emptyJournal();
    }
  },
  async save(data) {
    if (!safeStorage.setJSON(KEY, data)) throw new Error('No se pudo guardar en el navegador (almacenamiento lleno o bloqueado). Exportá tus datos a JSON.');
  },
};

/** Valida la forma básica de un diario (importación o almacenamiento). */
export function parseJournal(raw: unknown): JournalData {
  const d = raw as Partial<JournalData>;
  if (!d || typeof d !== 'object' || d.version !== 1) throw new Error('Archivo no reconocido (versión distinta o formato inválido).');
  if (!Array.isArray(d.paper) || !Array.isArray(d.real)) throw new Error('Faltan las listas de trades.');
  const base = emptyJournal();
  return {
    ...base,
    ...d,
    news: Array.isArray(d.news) ? d.news : [],
    phase: d.phase && typeof d.phase.phase === 'number' ? d.phase : base.phase,
    autoPaper: d.autoPaper ?? base.autoPaper,
  } as JournalData;
}

export interface ExportBundle {
  app: 'crypto-plan-analyzer';
  exportedAt: string;
  journal: JournalData;
  config?: unknown;
}

export function exportBundle(journal: JournalData, config: unknown): string {
  const b: ExportBundle = { app: 'crypto-plan-analyzer', exportedAt: new Date().toISOString(), journal, config };
  return JSON.stringify(b, null, 2);
}

export function importBundle(text: string): { journal: JournalData; config?: unknown } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }
  const b = parsed as Partial<ExportBundle>;
  if (b?.app !== 'crypto-plan-analyzer') throw new Error('El archivo no fue exportado por esta app.');
  return { journal: parseJournal(b.journal), config: b.config };
}
