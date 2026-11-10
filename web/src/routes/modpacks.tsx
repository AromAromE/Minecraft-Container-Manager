import { createFileRoute } from '@tanstack/react-router';
import { AppShell } from '../components/app-shell';
import { ModpackStore } from '../components/modpack-store';
import { RequireAuth } from '../components/require-auth';

export const Route = createFileRoute('/modpacks')({ component: ModpacksRoute });

export function ModpacksRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <ModpackStore />
      </AppShell>
    </RequireAuth>
  );
}
