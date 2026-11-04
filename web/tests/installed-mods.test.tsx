import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client';
import * as modDetails from '../src/api/mod-details';
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
    vi.spyOn(modDetails, 'fetchInstalledModDetails').mockResolvedValue(null);
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

  it('opens extended Modrinth information from a mod name and restores focus on Escape', async () => {
    const user = userEvent.setup();
    vi.mocked(api.mods).mockResolvedValue({ type: 'mods', items: [
      { ...mods[0], version: '0.100.0', mod_id: 'fabric-api', sha1: 'abc123' },
    ] });
    vi.mocked(modDetails.fetchInstalledModDetails).mockResolvedValue({
      title: 'Fabric API', description: 'Essential hooks for Fabric mods.',
      projectUrl: 'https://modrinth.com/mod/fabric-api', downloads: 1234567,
      license: 'Apache License 2.0', categories: ['library'],
      sourceUrl: 'https://github.com/FabricMC/fabric',
      wikiUrl: 'javascript:alert(1)',
    });
    renderWithAdmin(<ModsPanel server={server} />);

    // Details are fetched only when requested, not for the entire installed list.
    const trigger = await screen.findByRole('button', { name: 'View details for fabric-api' });
    expect(modDetails.fetchInstalledModDetails).not.toHaveBeenCalled();
    await user.click(trigger);

    const modal = await screen.findByRole('dialog', { name: 'Fabric API' });
    expect(within(modal).getByText('Essential hooks for Fabric mods.')).toBeInTheDocument();
    for (const text of ['fabric-api.jar', '0.100.0', 'Enabled', 'Apache License 2.0', 'library', 'abc123']) {
      expect(within(modal).getByText(text)).toBeInTheDocument();
    }
    const link = within(modal).getByRole('link', { name: 'Open in Modrinth' });
    expect(link).toHaveAttribute('href', 'https://modrinth.com/mod/fabric-api');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(modal).getByRole('link', { name: 'Source code' })).toHaveAttribute('href', 'https://github.com/FabricMC/fabric');
    expect(within(modal).queryByRole('link', { name: 'Wiki' })).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('keeps file details and the Modrinth link available if its catalog is unavailable', async () => {
    vi.mocked(modDetails.fetchInstalledModDetails).mockRejectedValue(new Error('Offline'));
    renderWithAdmin(<ModsPanel server={server} />);
    fireEvent.click(await screen.findByRole('button', { name: 'View details for fabric-api' }));

    const modal = screen.getByRole('dialog', { name: 'fabric-api' });
    expect(await within(modal).findByText(/Catalog details are unavailable/)).toBeInTheDocument();
    expect(within(modal).getByText('fabric-api.jar')).toBeInTheDocument();
    expect(within(modal).getByText('Unknown')).toBeInTheDocument();
    expect(within(modal).getByRole('link', { name: 'Open in Modrinth' })).toHaveAttribute('href', 'https://modrinth.com/mod/fabric-id');

    fireEvent.click(within(modal).getByRole('button', { name: 'Close mod details' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows local information for untracked uploads without inventing a catalog link', async () => {
    vi.mocked(api.mods).mockResolvedValue({ type: 'mods', items: [
      { ...mods[4], title: 'Custom mod', description: 'A private server mod.', version: '1.2.3' },
    ] });
    renderWithAdmin(<ModsPanel server={server} />);
    fireEvent.click(await screen.findByRole('button', { name: 'View details for custom' }));

    const modal = screen.getByRole('dialog', { name: 'Custom mod' });
    expect(await within(modal).findByText(/No catalog project is linked/)).toBeInTheDocument();
    expect(within(modal).getByText('A private server mod.')).toBeInTheDocument();
    expect(within(modal).getByText('1.2.3')).toBeInTheDocument();
    expect(within(modal).queryByRole('link')).not.toBeInTheDocument();
  });

  it('allows read-only users to view plugin details and follow the original provider', async () => {
    vi.mocked(api.mods).mockResolvedValue({ type: 'plugins', items: [mods[1]] });
    vi.mocked(modDetails.fetchInstalledModDetails).mockResolvedValue({
      title: 'Chunky', description: 'Pre-generates chunks.', author: 'pop4959',
      projectUrl: 'https://hangar.papermc.io/pop4959/Chunky', downloads: 100,
    });
    renderWithUser(<ModsPanel server={{ ...server, server_type: 'paper' }} />, {
      ...adminUser, role: 'custom', permissions: ['servers.view', 'mods.view'],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'View details for chunky' }));

    const modal = await screen.findByRole('dialog', { name: 'Chunky' });
    expect(within(modal).getByText('Installed plugin details')).toBeInTheDocument();
    expect(within(modal).getByText('Disabled')).toBeInTheDocument();
    expect(within(modal).getByText('pop4959')).toBeInTheDocument();
    expect(within(modal).getByRole('link', { name: 'Open in Hangar' })).toHaveAttribute('href', 'https://hangar.papermc.io/pop4959/Chunky');
    expect(screen.queryByRole('button', { name: 'Enable' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('passes discovered project metadata to details without mixing providers', async () => {
    vi.mocked(api.checkModUpdates).mockResolvedValue({
      last_checked: '', updates: {
        custom: {
          mod_name: 'custom', mod_file: 'custom.jar', provider: 'modrinth',
          project_id: 'discovered-id', project_slug: 'discovered-mod', title: 'Discovered mod',
          current_version: '1.0', latest_version: '2.0', latest_jar: 'custom-2.0.jar',
        },
        chunky: {
          mod_name: 'chunky', mod_file: 'chunky.jar', provider: 'modrinth',
          project_id: 'wrong-provider', title: 'Wrong catalog', latest_version: '2.0', latest_jar: 'chunky-2.0.jar',
        },
      },
    });
    renderWithAdmin(<ModsPanel server={server} />);
    await waitFor(() => expect(screen.getAllByText('Update Available: 2.0')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'View details for custom' }));
    const modal = screen.getByRole('dialog', { name: 'Discovered mod' });
    expect(within(modal).getByText('1.0')).toBeInTheDocument();
    expect(within(modal).getByRole('link', { name: 'Open in Modrinth' })).toHaveAttribute('href', 'https://modrinth.com/mod/discovered-mod');
    expect(modDetails.fetchInstalledModDetails).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: 'modrinth', project_id: 'discovered-id' }), 'mods', expect.any(AbortSignal),
    );
    fireEvent.click(within(modal).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'View details for chunky' }));
    expect(modDetails.fetchInstalledModDetails).toHaveBeenLastCalledWith(
      mods[1], 'mods', expect.any(AbortSignal),
    );
    expect(await within(screen.getByRole('dialog', { name: 'chunky' })).findByText(/Extended catalog details are unavailable/)).toBeInTheDocument();
  });

  it('cancels pending details when dismissed and does not leak them into another mod', async () => {
    let resolveDetails!: (details: modDetails.InstalledModDetails) => void;
    vi.mocked(modDetails.fetchInstalledModDetails).mockImplementationOnce(() => new Promise((resolve) => { resolveDetails = resolve; }));
    renderWithAdmin(<ModsPanel server={server} />);
    fireEvent.click(await screen.findByRole('button', { name: 'View details for fabric-api' }));
    const signal = vi.mocked(modDetails.fetchInstalledModDetails).mock.calls[0][2]!;
    expect(screen.getByText('Loading catalog details…')).toBeInTheDocument();
    const modal = screen.getByRole('dialog');
    fireEvent.mouseDown(modal.parentElement!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(signal.aborted).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'View details for custom' }));
    resolveDetails({ title: 'Stale project', description: 'Old details', projectUrl: 'https://modrinth.com/mod/stale', downloads: 1 });
    expect(await screen.findByText(/No catalog project is linked/)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'custom' })).toBeInTheDocument();
    expect(screen.queryByText('Old details')).not.toBeInTheDocument();
  });
});
