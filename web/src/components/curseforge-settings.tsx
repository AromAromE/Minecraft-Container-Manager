import { useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { saveCurseForgeApiKey } from '../api/curseforge';
import { usePermissions } from '../lib/auth';
import { useCurseForgeSettings } from '../lib/curseforge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';

export function CurseForgeSettings({ onSaved }: { onSaved?: () => void }) {
  const can = usePermissions();
  const { settings, loading, error: loadError, refresh } = useCurseForgeSettings();
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(value: string) {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await saveCurseForgeApiKey(value);
      setKey('');
      await refresh();
      setSaved(true);
      onSaved?.();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save CurseForge API key');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>CurseForge API Key</CardTitle>
        <CardDescription>One server-side key is shared by all users for browsing, installs, and update checks. The saved key is never returned to browsers.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? <p role="status" className="text-sm text-muted-foreground">Loading CurseForge settings…</p> : (
          <p className="text-sm text-muted-foreground">
            {settings?.configured ? `Connected using ${settings.source === 'environment' ? 'CURSEFORGE_API_KEY on the panel' : 'the shared saved key'}.` : 'No shared API key is configured.'}
          </p>
        )}
        {can('settings.manage') ? (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(key); }}>
            <div className="space-y-2">
              <Label htmlFor="curseforge-api-key">{settings?.configured ? 'Replace API key' : 'API key'}</Label>
              <Input id="curseforge-api-key" type="password" autoComplete="new-password" value={key} onChange={(event) => { setKey(event.target.value); setSaved(false); }} placeholder="Paste your CurseForge API key" disabled={saving} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!key.trim() || saving || loading}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save shared key</Button>
              {settings?.source === 'database' && <Button type="button" variant="outline" disabled={saving} onClick={() => void save('')}>Remove saved key</Button>}
            </div>
            <p className="text-xs text-muted-foreground">Removing a saved key falls back to CURSEFORGE_API_KEY, if set on the panel. Previously browser-only keys must be entered here once.</p>
          </form>
        ) : <p className="text-sm text-muted-foreground">Ask an administrator to configure the shared CurseForge API key in App Settings.</p>}
        {(error || loadError) && <p role="alert" className="text-sm text-destructive">{error || loadError}</p>}
        {saved && <p role="status" className="text-sm text-muted-foreground">Shared CurseForge settings saved.</p>}
        <a href="https://console.curseforge.com/#/api-keys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">Get a key on CurseForge Console <ExternalLink className="h-3 w-3" /></a>
      </CardContent>
    </Card>
  );
}
