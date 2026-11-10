import { catalogTarget } from './catalog-fixtures';
import { clearRateLimitCache } from '../src/api/rate-limited-fetch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCurseForgeSettings,
  getCurseForgeClassId,
  getCurseForgeDownloadUrl,
  getCurseForgeLoaderType,
  isCurseForgeModInstalled,
  searchCurseForge,
  saveCurseForgeApiKey,
  getCurseForgeFiles,
  getCurseForgeMods,
  searchCurseForgeModpacks,
  getCurseForgeModpackFiles,
  getCurseForgeCategories,
  installCurseForgeServer,
} from '../src/api/curseforge';
import type { CurseForgeMod, Mod } from '../src/api/types';

describe('CurseForge API client', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
 clearRateLimitCache();
 document.cookie="mcm_csrf=test-csrf; path=/";
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    localStorage.clear();
  });

  it('saves the shared credential only to the server and reads redacted status', async () => {
    const status = { configured: true, source: 'database' };
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(status)));
    global.fetch = fetchMock;
    localStorage.setItem('mcm_curseforge_api_key', 'legacy-key');

    await expect(saveCurseForgeApiKey(' test-key-12345 ')).resolves.toEqual(status);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/curseforge/settings');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ api_key: 'test-key-12345' }) });
    expect(localStorage.getItem('mcm_curseforge_api_key')).toBeNull();
    await expect(getCurseForgeSettings()).resolves.toEqual(status);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/curseforge/settings');
  });

  it('maps server types to loaders and classes correctly', () => {
    expect(getCurseForgeLoaderType('forge')).toBe(1);
    expect(getCurseForgeLoaderType('fabric')).toBe(4);
    expect(getCurseForgeLoaderType('neoforge')).toBe(6);
    expect(getCurseForgeLoaderType('paper')).toBeUndefined();

    expect(getCurseForgeClassId('paper')).toBe(5);
    expect(getCurseForgeClassId('spigot')).toBe(5);
    expect(getCurseForgeClassId('fabric')).toBe(6);
    expect(getCurseForgeClassId('forge')).toBe(6);
  });

  it('searches through the authenticated server endpoint without a browser credential', async () => {
    const mockCFResult = {
      data: [
        {
          id: 306612,
          gameId: 432,
          name: 'JEI - Just Enough Items',
          slug: 'jei',
          summary: 'Item and Recipe viewing mod',
          downloadCount: 150000000,
          categories: [],
          authors: [{ id: 1, name: 'mezz', url: '' }],
          latestFiles: [],
          dateModified: '2026-08-01T00:00:00Z',
        },
      ],
      pagination: { index: 0, pageSize: 20, totalCount: 1 },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockCFResult,
    });
    global.fetch = fetchMock;

    const res = await searchCurseForge(
      {
        query: 'jei',
        classId: 6,
        modLoaderType: 4,
        gameVersion: '1.20.4',
        sortField: 6,
        pageSize: 20,
        index: 0,
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const rawUrl=String(fetchMock.mock.calls[0][0]);
 expect(rawUrl).toMatch(/^\/api\/curseforge\/mods\/search\?/);
 const calledUrl = catalogTarget(rawUrl);
    const calledInit = fetchMock.mock.calls[0][1] as RequestInit;

    expect(calledUrl).toContain('https://api.curseforge.com/v1/mods/search');
    expect(calledUrl).toContain('searchFilter=jei');
    expect(calledUrl).toContain('modLoaderType=4');
    expect(calledUrl).toContain('gameVersion=1.20.4');

    expect(new Headers(calledInit.headers).has('x-api-key')).toBe(false);
    expect(calledInit.credentials).toBe('include');
    expect(res.data[0].name).toBe('JEI - Just Enough Items');
  });

  it('getCurseForgeDownloadUrl resolves CDN download URL', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: 'https://edge.forgecdn.net/files/123/456/jei.jar' }),
    });

    const url = await getCurseForgeDownloadUrl(306612, 123456);
    expect(url).toBe('https://edge.forgecdn.net/files/123/456/jei.jar');
  });

  it('uses server-side files and batch lookups even when a legacy browser key exists', async () => {
    localStorage.setItem('mcm_curseforge_api_key', 'do-not-forward');
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ data: [] })));
    global.fetch = fetchMock;
    await getCurseForgeFiles(123, { gameVersion: '1.21.1' });
    await getCurseForgeMods([123]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/curseforge/mods/123/files?gameVersion=1.21.1&pageSize=25',
      '/api/curseforge/mods',
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init.headers).has('x-api-key')).toBe(false);
      expect(new Headers(init.headers).has('x-curseforge-api-key')).toBe(false);
      expect(JSON.stringify(init)).not.toContain('do-not-forward');
    }
  });

  it('reports missing server configuration', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Configure a shared key' } }), { status: 503 }));
    await expect(searchCurseForge({})).rejects.toThrow('Configure a shared key');
  });

  it('isCurseForgeModInstalled detects installed mod matching slug', () => {
    const installedMods: Mod[] = [
      { name: 'jei-1.20.4', file: 'jei-1.20.4-fabric-15.0.0.jar', enabled: true },
    ];

    const jeiMod: Pick<CurseForgeMod, 'name' | 'slug'> = {
      name: 'Just Enough Items',
      slug: 'jei',
    };

    expect(isCurseForgeModInstalled(jeiMod, installedMods)).toBe(true);
  });

  it('searches modpacks using searchCurseForgeModpacks proxy endpoint', async () => {
    const mockModpacks = {
      data: [
        {
          id: 55555,
          name: 'All the Mods 9',
          slug: 'all-the-mods-9',
          summary: 'Huge modpack',
          downloadCount: 5000000,
          latestFiles: [],
        },
      ],
      pagination: { index: 0, pageSize: 20, totalCount: 1 },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockModpacks,
    });
    global.fetch = fetchMock;

    const res = await searchCurseForgeModpacks({
      searchFilter: 'ATM9',
      gameVersion: '1.20.1',
      modLoaderType: 1,
      sortField: 2,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('/api/v1/curseforge/modpacks?');
    expect(calledUrl).toContain('searchFilter=ATM9');
    expect(calledUrl).toContain('gameVersion=1.20.1');
    expect(calledUrl).toContain('modLoaderType=1');
    expect(calledUrl).toContain('sortField=2');
    expect(res.data[0].name).toBe('All the Mods 9');
  });

  it('retrieves modpack files highlighting server pack availability', async () => {
    const mockFiles = {
      data: [
        {
          id: 9991,
          displayName: 'ATM9 v1.0',
          fileName: 'ATM9-1.0.zip',
          serverPackFileId: 9992,
          hasServerPack: true,
        },
      ],
      pagination: { index: 0, pageSize: 25, totalCount: 1 },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockFiles,
    });
    global.fetch = fetchMock;

    const res = await getCurseForgeModpackFiles(55555, { gameVersion: '1.20.1', modLoaderType: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('/api/v1/curseforge/modpacks/55555/files?');
    expect(calledUrl).toContain('gameVersion=1.20.1');
    expect(calledUrl).toContain('modLoaderType=1');
    expect(res.data[0].hasServerPack).toBe(true);
    expect(res.data[0].serverPackFileId).toBe(9992);
  });

  it('retrieves modpack categories', async () => {
    const mockCats = {
      data: [{ id: 10, name: 'Adventure and RPG', slug: 'adventure-rpg' }],
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockCats,
    });

    const categories = await getCurseForgeCategories();
    expect(categories).toEqual([{ id: 10, name: 'Adventure and RPG', slug: 'adventure-rpg' }]);
  });

  it('posts server deployment request via installCurseForgeServer', async () => {
    const mockDeployResp = {
      status: 'deployed',
      server: { id: 'srv-123', name: 'My Modpack Server', host_port: 25565 },
      id: 'srv-123',
      name: 'My Modpack Server',
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockDeployResp,
    });
    global.fetch = fetchMock;

    const res = await installCurseForgeServer({
      modId: 55555,
      fileId: 9991,
      serverName: 'My Modpack Server',
      memoryLimit: '8GB',
      port: 25565,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('/api/v1/curseforge/install-server');
    expect(res.status).toBe('deployed');
    expect(res.name).toBe('My Modpack Server');
  });

  it('unpacks structured API errors into readable strings rather than [object Object]', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: { code: 'csrf_missing', message: 'missing or invalid CSRF token' },
      }),
    });
    global.fetch = fetchMock;

    await expect(
      installCurseForgeServer(
        {
          modId: 55555,
          fileId: 9991,
          serverName: 'RAD Server',
          memoryLimit: '8GB',
          port: 25565,
        },
        vi.fn(),
      ),
    ).rejects.toThrow('missing or invalid CSRF token');
  });
});
