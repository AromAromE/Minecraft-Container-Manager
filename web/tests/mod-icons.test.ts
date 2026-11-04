import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchInstalledModIcons } from '../src/api/mod-icons';
import { clearRateLimitCache } from '../src/api/rate-limited-fetch';
import type { Mod } from '../src/api/types';
import { catalogTarget, jsonResponse } from './catalog-fixtures';

const installedMod = (name: string, metadata: Partial<Mod> = {}): Mod => ({
  name, file: `${name}.jar`, enabled: true, ...metadata,
});

describe('installed mod artwork', () => {
  beforeEach(() => {
    clearRateLimitCache();
    document.cookie = 'mcm_csrf=test-csrf; path=/';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearRateLimitCache();
  });

  it('resolves all providers, batches project lookups, and reuses cached responses', async () => {
    const mods = [
      installedMod('fabric-api', { provider: 'modrinth', project_id: 'P7dR8mSH' }),
      installedMod('fabric-api-old', { provider: 'modrinth', project_id: 'P7dR8mSH' }),
      installedMod('lithium', { provider: 'modrinth', project_slug: 'lithium' }),
      installedMod('chunky', { provider: 'hangar', project_id: '123', project_slug: 'Chunky' }),
      installedMod('luckperms', { provider: 'spiget', project_id: '28140' }),
      installedMod('jei', { provider: 'curseforge', project_id: '238222' }),
      installedMod('custom'),
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(catalogTarget(input));
      if (url.hostname === 'api.modrinth.com') {
        expect(JSON.parse(url.searchParams.get('ids')!)).toEqual(['P7dR8mSH', 'lithium']);
        return jsonResponse([
          { id: 'P7dR8mSH', slug: 'fabric-api', icon_url: 'https://example.test/fabric.png' },
          { id: 'lithium-id', slug: 'lithium', icon_url: 'https://example.test/lithium.png' },
        ]);
      }
      if (url.hostname === 'hangar.papermc.io') {
        expect(url.pathname).toBe('/api/v1/projects/Chunky');
        return jsonResponse({ avatarUrl: 'https://example.test/chunky.png' });
      }
      if (url.hostname === 'api.spiget.org') {
        expect(url.pathname).toBe('/v2/resources/28140');
        return jsonResponse({ icon: { url: 'data/icons/luckperms.png' } });
      }
      if (url.hostname === 'api.curseforge.com') {
        return jsonResponse({ data: [{ id: 238222, logo: { url: 'https://example.test/jei.png' } }] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const expected = {
      'fabric-api': 'https://example.test/fabric.png',
      'fabric-api-old': 'https://example.test/fabric.png',
      lithium: 'https://example.test/lithium.png',
      chunky: 'https://example.test/chunky.png',
      luckperms: 'https://static.spigotmc.org/data/icons/luckperms.png',
      jei: 'https://example.test/jei.png',
    };
    await expect(fetchInstalledModIcons(mods)).resolves.toEqual(expected);
    await expect(fetchInstalledModIcons(mods)).resolves.toEqual(expected);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('skips unknown projects and invalid numeric IDs', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchInstalledModIcons([
      installedMod('custom'),
      installedMod('unidentified', { provider: 'modrinth' }),
      installedMod('unknown-provider', { project_id: '123' }),
      installedMod('invalid-curseforge', { provider: 'curseforge', project_id: 'not-an-id' }),
      installedMod('invalid-spigot', { provider: 'spiget', project_id: 'not-an-id' }),
    ])).resolves.toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps successful icons when another provider fails or returns no artwork', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = catalogTarget(input);
      if (url.includes('hangar.papermc.io')) throw new Error('Provider unavailable');
      if (url.includes('api.modrinth.com')) return jsonResponse([{ id: 'no-icon', icon_url: null }]);
      return jsonResponse({ icon: { data: 'ICON_DATA' } });
    }));

    await expect(fetchInstalledModIcons([
      installedMod('no-icon', { provider: 'modrinth', project_id: 'no-icon' }),
      installedMod('chunky', { provider: 'hangar', project_slug: 'Chunky' }),
      installedMod('luckperms', { provider: 'spiget', project_id: '28140' }),
    ])).resolves.toEqual({ luckperms: 'data:image/png;base64,ICON_DATA' });
  });
});
