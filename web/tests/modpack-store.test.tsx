import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModpackStore } from '../src/components/modpack-store';
import { api } from '../src/api/client';
import * as curseforgeApi from '../src/api/curseforge';
import * as curseforgeLib from '../src/lib/curseforge';
import { renderWithAdmin } from '../src/test/auth';
import type { CurseForgeMod, CurseForgeFile, InstallCurseForgeServerResponse } from '../src/api/types';

const mockModpacks: CurseForgeMod[] = [
  {
    id: 55555,
    gameId: 432,
    name: 'All the Mods 9',
    slug: 'all-the-mods-9',
    summary: 'ATM9 modpack with tons of quests and magic and tech.',
    status: 1,
    downloadCount: 4500000,
    isFeatured: true,
    primaryCategoryId: 10,
    categories: [
      { id: 10, gameId: 432, name: 'Adventure', slug: 'adventure', url: '', iconUrl: '' },
      { id: 11, gameId: 432, name: 'Tech', slug: 'tech', url: '', iconUrl: '' },
    ],
    authors: [{ id: 1, name: 'ATMTeam', url: '' }],
    dateModified: '2026-09-01T00:00:00Z',
    dateCreated: '2025-01-01T00:00:00Z',
    dateReleased: '2025-01-01T00:00:00Z',
    links: { websiteUrl: '' },
    latestFiles: [
      {
        id: 9991,
        gameId: 432,
        modId: 55555,
        isAvailable: true,
        displayName: 'ATM9 v1.0.0',
        fileName: 'ATM9-1.0.0.zip',
        releaseType: 1,
        fileStatus: 1,
        hashes: [],
        fileDate: '2026-09-01T00:00:00Z',
        fileLength: 500000000,
        downloadCount: 100000,
        downloadUrl: 'https://example.com/atm9.zip',
        gameVersions: ['1.20.1', 'NeoForge'],
        serverPackFileId: 9992,
        hasServerPack: true,
      },
    ],
  },
];

const mockFiles: CurseForgeFile[] = [
  {
    id: 9991,
    gameId: 432,
    modId: 55555,
    isAvailable: true,
    displayName: 'ATM9 v1.0.0',
    fileName: 'ATM9-1.0.0.zip',
    releaseType: 1,
    fileStatus: 1,
    hashes: [],
    fileDate: '2026-09-01T00:00:00Z',
    fileLength: 500000000,
    downloadCount: 100000,
    downloadUrl: 'https://example.com/atm9.zip',
    gameVersions: ['1.20.1', 'NeoForge'],
    serverPackFileId: 9992,
    hasServerPack: true,
  },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ModpackStore', () => {
  beforeEach(() => {
    vi.spyOn(api, 'availablePorts').mockResolvedValue({ available: [25565, 25566], used: [] });
    vi.spyOn(api, 'listServers').mockResolvedValue([]);
    vi.spyOn(curseforgeApi, 'getCurseForgeCategories').mockResolvedValue([
      { id: 10, gameId: 432, name: 'Adventure', slug: 'adventure', url: '', iconUrl: '' },
      { id: 11, gameId: 432, name: 'Tech', slug: 'tech', url: '', iconUrl: '' },
    ]);
  });

  it('renders the store title and unconfigured banner when CurseForge key is missing', async () => {
    vi.spyOn(curseforgeLib, 'useCurseForgeSettings').mockReturnValue({
      settings: { configured: false, source: '' },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    renderWithAdmin(<ModpackStore />);

    expect(screen.getByText('CurseForge Modpack Store')).toBeInTheDocument();
    expect(screen.getByText('CurseForge API Key Required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /configure key now/i })).toBeInTheDocument();
  });

  it('renders modpack cards and executes search when configured', async () => {
    vi.spyOn(curseforgeLib, 'useCurseForgeSettings').mockReturnValue({
      settings: { configured: true, source: 'database' },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    const searchSpy = vi.spyOn(curseforgeApi, 'searchCurseForgeModpacks').mockResolvedValue({
      data: mockModpacks,
      pagination: { index: 0, pageSize: 18, totalCount: 1 },
    });

    renderWithAdmin(<ModpackStore />);

    await waitFor(() => {
      expect(searchSpy).toHaveBeenCalled();
      expect(screen.getByText('All the Mods 9')).toBeInTheDocument();
      expect(screen.getByText('ATMTeam')).toBeInTheDocument();
      expect(screen.getByText(/ATM9 modpack with tons of quests/)).toBeInTheDocument();
      expect(screen.getByText('MC 1.20.1')).toBeInTheDocument();
      expect(screen.getByText('NeoForge')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /install server/i })).toBeInTheDocument();
    });
  });

  it('opens the Install Server modal and deploys a container', async () => {
    const user = userEvent.setup();

    vi.spyOn(curseforgeLib, 'useCurseForgeSettings').mockReturnValue({
      settings: { configured: true, source: 'database' },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    vi.spyOn(curseforgeApi, 'searchCurseForgeModpacks').mockResolvedValue({
      data: mockModpacks,
      pagination: { index: 0, pageSize: 18, totalCount: 1 },
    });

    vi.spyOn(curseforgeApi, 'getCurseForgeModpackFiles').mockResolvedValue({
      data: mockFiles,
      pagination: { index: 0, pageSize: 50, totalCount: 1 },
    });

    const installSpy = vi.spyOn(curseforgeApi, 'installCurseForgeServer').mockResolvedValue({
      server: {
        id: 'srv-atm9',
        name: 'All the Mods 9 Server',
        server_type: 'neoforge',
        version: '1.20.1',
        ram_mb: 8192,
        cpu_limit: 1,
        memory_limit_mb: 8192,
        host_port: 25565,
        extra_ports: [],
        container_id: 'container-atm9',
        state: 'running',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      id: 'srv-atm9',
      name: 'All the Mods 9 Server',
      status: 'deployed',
    });

    renderWithAdmin(<ModpackStore />);

    // Wait for card to render
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /install server/i })).toBeInTheDocument();
    });

    // Click Install Server
    await user.click(screen.getByRole('button', { name: /install server/i }));

    // Modal opens
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /deploy all the mods 9/i })).toBeInTheDocument();
      expect(screen.getByText(/server pack available/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/server container name/i)).toHaveValue('All the Mods 9 Server');
      expect(screen.getByLabelText(/primary host game port/i)).toHaveValue(25565);
      expect(screen.getByText('8 GB (8192 MB)')).toBeInTheDocument();
    });

    // Click Deploy Container button
    const deployBtn = screen.getByRole('button', { name: /deploy container/i });
    await user.click(deployBtn);

    // Verify deployment called with correct arguments
    await waitFor(() => {
      expect(installSpy).toHaveBeenCalledWith(
        {
          modId: 55555,
          fileId: 9991,
          serverName: 'All the Mods 9 Server',
          memoryLimit: '8GB',
          port: 25565,
        },
        expect.any(Function),
      );
    });

    // Verify success confirmation view
    await waitFor(() => {
      expect(screen.getByText('Server Container Deployed!')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /open server console/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /go to dashboard/i })).toBeInTheDocument();
    });
  });
});
