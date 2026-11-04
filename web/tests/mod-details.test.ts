import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchInstalledModDetails, getInstalledModProjectUrl, resolveInstalledModMetadata } from '../src/api/mod-details';
import { clearRateLimitCache } from '../src/api/rate-limited-fetch';
import type { Mod } from '../src/api/types';
import { catalogTarget, jsonResponse } from './catalog-fixtures';

const mod = (metadata: Partial<Mod> = {}): Mod => ({
  name: 'installed', file: 'installed.jar', enabled: true, ...metadata,
});

describe('installed mod project details', () => {
  beforeEach(() => {
    clearRateLimitCache();
    document.cookie = 'mcm_csrf=test-csrf; path=/';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearRateLimitCache();
  });

  it('uses Modrinth project information, its actual project type, and cached requests', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(catalogTarget(input)).toBe('https://api.modrinth.com/v2/project/fabric-id');
      return jsonResponse({
        title: 'Fabric API', slug: 'fabric-api', project_type: 'mod', description: 'Fabric hooks',
        downloads: 1000, categories: ['library'], license: { name: 'Apache 2.0' },
        source_url: 'https://github.com/FabricMC/fabric', wiki_url: null, issues_url: null,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const installed = mod({ provider: 'modrinth', project_id: 'fabric-id', project_slug: 'old-slug' });
    const expected = {
      title: 'Fabric API', description: 'Fabric hooks', projectUrl: 'https://modrinth.com/mod/fabric-api',
      downloads: 1000, categories: ['library'], license: 'Apache 2.0',
      sourceUrl: 'https://github.com/FabricMC/fabric', wikiUrl: null, issuesUrl: null,
    };
    await expect(fetchInstalledModDetails(installed, 'plugins')).resolves.toEqual(expected);
    await expect(fetchInstalledModDetails(installed, 'plugins')).resolves.toEqual(expected);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resolves the original Hangar, SpigotMC, and CurseForge projects', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = catalogTarget(input);
      if (url.includes('hangar.papermc.io')) {
        expect(url).toContain('/projects/Chunky');
        return jsonResponse({
          name: 'Chunky', description: 'Pre-generation', namespace: { owner: 'pop4959', slug: 'Chunky' },
          stats: { downloads: 12 }, category: 'WORLD_MANAGEMENT',
        });
      }
      if (url.includes('api.spiget.org')) {
        expect(url).toContain('/resources/28140');
        return jsonResponse({ id: 28140, name: 'LuckPerms', tag: 'Permissions', author: { name: 'Luck' }, downloads: 34 });
      }
      if (url.includes('api.curseforge.com')) {
        return jsonResponse({ data: [{
          id: 238222, name: 'JEI', summary: 'Recipes', downloadCount: 56,
          authors: [{ name: 'mezz' }], categories: [{ name: 'Utility' }],
          links: { websiteUrl: 'https://www.curseforge.com/minecraft/mc-mods/jei' },
        }] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    await expect(fetchInstalledModDetails(mod({ provider: 'hangar', project_id: '123', project_slug: 'Chunky' }), 'plugins')).resolves.toMatchObject({
      title: 'Chunky', author: 'pop4959', downloads: 12, projectUrl: 'https://hangar.papermc.io/pop4959/Chunky',
    });
    await expect(fetchInstalledModDetails(mod({ provider: 'spiget', project_id: '28140' }), 'plugins')).resolves.toMatchObject({
      title: 'LuckPerms', description: 'Permissions', downloads: 34, projectUrl: 'https://www.spigotmc.org/resources/28140',
    });
    await expect(fetchInstalledModDetails(mod({ provider: 'curseforge', project_id: '238222' }), 'mods')).resolves.toMatchObject({
      title: 'JEI', author: 'mezz', downloads: 56, projectUrl: 'https://www.curseforge.com/minecraft/mc-mods/jei',
    });
  });

  it('does not fetch unidentified uploads or invalid numeric project IDs', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const installed of [
      mod({ mod_id: 'fabric-api' }), mod({ project_id: '123' }), mod({ provider: 'modrinth' }),
      mod({ provider: 'hangar' }), mod({ provider: 'spiget', project_id: 'NaN' }),
      mod({ provider: 'curseforge', project_id: 'NaN' }),
    ]) {
      await expect(fetchInstalledModDetails(installed, 'mods')).resolves.toBeNull();
      expect(getInstalledModProjectUrl(installed, 'mods')).toBeUndefined();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retains fallback provider links without catalog access and encodes identifiers', () => {
    expect(getInstalledModProjectUrl(mod({ provider: 'modrinth', project_slug: 'my plugin' }), 'plugins')).toBe('https://modrinth.com/plugin/my%20plugin');
    expect(getInstalledModProjectUrl(mod({ provider: 'spiget', project_id: '28140' }), 'plugins')).toBe('https://www.spigotmc.org/resources/28140');
    expect(getInstalledModProjectUrl(mod({ provider: 'hangar', project_slug: 'Chunky' }), 'plugins')).toBeUndefined();
    expect(getInstalledModProjectUrl(mod({ provider: 'hangar', project_slug: 'pop4959/Chunky' }), 'plugins')).toBe('https://hangar.papermc.io/pop4959/Chunky');
    expect(getInstalledModProjectUrl(mod({ provider: 'curseforge', project_id: '238222' }), 'mods')).toBe('https://www.curseforge.com/projects/238222');
    expect(getInstalledModProjectUrl(mod({ provider: 'curseforge', project_slug: 'jei' }), 'mods')).toBe('https://www.curseforge.com/minecraft/mc-mods/jei');
    expect(getInstalledModProjectUrl(mod({ provider: 'curseforge', project_slug: 'plugin' }), 'plugins')).toBe('https://www.curseforge.com/minecraft/bukkit-plugins/plugin');
  });

  it('does not merge discovered metadata from a different provider', () => {
    const installed = mod({ provider: 'hangar', project_slug: 'Chunky', version: '1.0' });
    expect(resolveInstalledModMetadata(installed, {
      provider: 'modrinth', modName: 'installed', modFile: 'installed.jar',
      projectId: 'wrong-id', title: 'Wrong title', currentVersion: 'wrong-version', latestJar: 'new.jar', latestVersion: '2.0',
    })).toBe(installed);
  });

  it('reports unavailable CurseForge details rather than hiding local information', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [] })));
    await expect(fetchInstalledModDetails(mod({ provider: 'curseforge', project_id: '238222' }), 'mods')).rejects.toThrow('CurseForge project details are unavailable');
  });
});
