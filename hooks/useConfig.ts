'use client';
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_CONFIG, type AppConfig } from '@/lib/config/defaults';
import { sanitizeConfig } from '@/lib/config/schema';
import { safeStorage } from '@/lib/storage/safe-storage';

const KEY = 'cpa.config.v1';

export function useConfig() {
  const [config, setConfigState] = useState<AppConfig>(DEFAULT_CONFIG);
  const [corrections, setCorrections] = useState<string[]>([]);

  useEffect(() => {
    const { config: c, corrections: corr } = sanitizeConfig(safeStorage.getJSON(KEY));
    setConfigState(c);
    setCorrections(corr);
  }, []);

  const setConfig = useCallback((next: AppConfig) => {
    const { config: c, corrections: corr } = sanitizeConfig(next);
    setConfigState(c);
    setCorrections(corr);
    safeStorage.setJSON(KEY, c);
  }, []);

  const reset = useCallback(() => setConfig(DEFAULT_CONFIG), [setConfig]);
  return { config, setConfig, reset, corrections };
}
