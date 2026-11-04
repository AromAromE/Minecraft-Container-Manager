import { useCallback, useEffect, useState } from 'react';
import { getCurseForgeSettings, type CurseForgeSettings } from '../api/curseforge';

export function useCurseForgeSettings(enabled = true) {
  const [settings, setSettings] = useState<CurseForgeSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setSettings(await getCurseForgeSettings());
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not read CurseForge settings');
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const update = () => {
      void getCurseForgeSettings().then((value) => {
        if (active) { setSettings(value); setError(null); }
      }).catch((error: unknown) => {
        if (active) setError(error instanceof Error ? error.message : 'Could not read CurseForge settings');
      });
    };
    update();
    window.addEventListener('mcm:curseforge-settings', update);
    window.addEventListener('focus', update);
    return () => {
      active = false;
      window.removeEventListener('mcm:curseforge-settings', update);
      window.removeEventListener('focus', update);
    };
  }, [enabled]);

  return { settings, loading: enabled && settings === null && !error, error, refresh };
}
