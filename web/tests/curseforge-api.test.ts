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
});
