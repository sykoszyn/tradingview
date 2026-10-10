'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JournalData } from '@/lib/journal/types';
import { localRepository } from '@/lib/storage/repository';

export function useJournal() {
  const [data, setData] = useState<JournalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    localRepository.load().then((d) => {
      loaded.current = true;
      setData(d);
    });
  }, []);

  useEffect(() => {
    if (!loaded.current || !data) return;
    localRepository.save(data).then(
      () => setError(null),
      (e) => setError((e as Error).message),
    );
  }, [data]);

  const update = useCallback((fn: (d: JournalData) => JournalData) => setData((prev) => (prev ? fn(prev) : prev)), []);
  const replace = useCallback((d: JournalData) => setData(d), []);
  return { data, update, replace, error };
}

export type JournalApi = ReturnType<typeof useJournal>;
