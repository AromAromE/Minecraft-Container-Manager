import { useSyncExternalStore } from 'react';
import { RefreshCw } from 'lucide-react';
import { browserBuildNeedsRefresh, fullRefreshPanel, getPanelBuildCommit, subscribePanelBuild } from '../lib/panel-build';
import { Button } from './ui/button';

export function PanelBuildNotice() {
  const commit = useSyncExternalStore(subscribePanelBuild, getPanelBuildCommit, () => null);
  if (!commit || !browserBuildNeedsRefresh(commit)) return null;

  return <div role="status" className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted px-5 py-3 text-sm sm:px-8 lg:px-10">
    <p>This browser’s MCM interface is out of date. Full refresh to load the running panel’s build.</p>
    <Button variant="outline" size="sm" onClick={() => fullRefreshPanel(commit)}><RefreshCw />Full refresh</Button>
  </div>;
}
