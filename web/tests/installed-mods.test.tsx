import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client';
import * as modIcons from '../src/api/mod-icons';
import type { Mod, Server } from '../src/api/types';
import { ModsPanel } from '../src/components/mods-panel';
import { adminUser, renderWithAdmin, renderWithUser } from '../src/test/auth';

const server: Server = {
  id: 'installed-mods-test', name: 'Test server', server_type: 'fabric', version: '1.21.1', build: '',
  ram_mb: 4096, cpu_limit: 2, memory_limit_mb: 4096, host_port: 25565, extra_ports: [],
  container_id: '', state: 'stopped', created_at: '', updated_at: '',
};

const mods: Mod[] = [
  { name: 'fabric-api', file: 'fabric-api.jar', enabled: true, provider: 'modrinth', project_id: 'fabric-id' },
  { name: 'chunky', file: 'chunky.jar', enabled: false, provider: 'hangar', project_slug: 'Chunky' },
  { name: 'luckperms', file: 'luckperms.jar', enabled: true, provider: 'spiget', project_id: '28140' },
  { name: 'jei', file: 'jei.jar', enabled: true, provider: 'curseforge', project_id: '238222' },
  { name: 'custom', file: 'custom.jar', enabled: true },
];

describe('installed mods and plugins list', () => {
  beforeEach(() => {
    vi.spyOn(api, 'mods').mockResolvedValue({ type: 'mods', items: mods });
    vi.spyOn(api, 'getInstalledModpack').mockResolvedValue({ installed: false, modpack: null });
    vi.spyOn(api, 'checkModUpdates').mockResolvedValue({ updates: {}, last_checked: '' });
    vi.spyOn(modIcons, 'fetchInstalledModIcons').mockImplementation(async (items) =>
      Object.fromEntries(items.filter((item) => item.provider).map((item) => [
        item.name, `https://example.test/${item.name}.png`,
      ])),
    );
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('shows catalog artwork and friendly provider names alongside installed mod details', async () => {
    renderWithAdmin(<ModsPanel server={server} />);

    for (const name of ['fabric-api', 'chunky', 'luckperms', 'jei']) {
      expect(await screen.findByRole('img', { name: `${name} icon` })).toHaveAttribute(
        'src', `https://example.test/${name}.png`,
      );
    }
    for (const label of ['Modrinth', 'Hangar', 'SpigotMC', 'CurseForge']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('fabric-api.jar', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('disabled')).toBeInTheDocument();
    expect(screen.getByText('custom')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'custom icon' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument();
  });

  it('uses a fallback icon for broken artwork without hiding the name or provider', async () => {
    renderWithAdmin(<ModsPanel server={server} />);

    const image = await screen.findByRole('img', { name: 'fabric-api icon' });
    const iconBox = image.parentElement!;
    fireEvent.error(image);

    expect(screen.queryByRole('img', { name: 'fabric-api icon' })).not.toBeInTheDocument();
    expect(iconBox.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('fabric-api')).toBeInTheDocument();
    expect(screen.getByText('Modrinth')).toBeInTheDocument();
  });

  it('also shows artwork and providers in the read-only plugins list', async () => {
    vi.mocked(api.mods).mockResolvedValue({ type: 'plugins', items: [mods[1]] });
    renderWithUser(<ModsPanel server={{ ...server, server_type: 'paper' }} />, {
      ...adminUser, role: 'custom', permissions: ['servers.view', 'mods.view'],
    });

    const list = await screen.findByRole('list');
    expect(await within(list).findByRole('img', { name: 'chunky icon' })).toBeInTheDocument();
    expect(within(list).getByText('Hangar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enable' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('uses provider metadata discovered by the update check without mixing catalogs', async () => {
    vi.mocked(api.mods).mockResolvedValue({ type: 'mods', items: [
      { name: 'uploaded', file: 'uploaded.jar', enabled: true },
      mods[1],
    ] });
    vi.mocked(api.checkModUpdates).mockResolvedValue({
      last_checked: '',
      updates: Object.fromEntries(['uploaded', 'chunky'].map((name) => [name, {
        mod_name: name, mod_file: `${name}.jar`, provider: 'modrinth' as const,
        project_id: 'discovered-id', title: name, latest_version: '2.0', latest_jar: `${name}-2.0.jar`,
      }])),
    });
    renderWithAdmin(<ModsPanel server={server} />);

    expect(await screen.findByRole('img', { name: 'uploaded icon' })).toBeInTheDocument();
    expect(screen.getByText('Modrinth')).toBeInTheDocument();
    expect(screen.getByText('Hangar')).toBeInTheDocument();
    await waitFor(() => {
      expect(modIcons.fetchInstalledModIcons).toHaveBeenLastCalledWith([
        expect.objectContaining({ name: 'uploaded', provider: 'modrinth', project_id: 'discovered-id' }),
        mods[1],
      ]);
    });
  });
});
