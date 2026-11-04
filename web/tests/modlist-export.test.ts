import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mod, Server } from '../src/api/types';
import { createModListExport, downloadModList } from '../src/lib/modlist-export';

const server: Pick<Server, 'name' | 'server_type' | 'version'> = {
  name: 'Fabric Survival', server_type: 'fabric', version: '1.21.1',
};

describe('modlist text export', () => {
  it('includes server details and sorts all entries without changing the installed list', () => {
    const items: Mod[] = [
      { name: 'private', title: 'Private mod', file: 'private.jar.disabled', enabled: false },
      {
        name: 'fabric-api', title: 'Fabric API', file: 'fabric-api-0.100.0.jar', enabled: true,
        version: '0.100.0', provider: 'modrinth', project_slug: 'fabric-api',
      },
    ];

    const result = createModListExport(server, { type: 'mods', items });

    expect(result.filename).toBe('Fabric-Survival-modlist.txt');
    expect(result.content).toBe([
      'Minecraft Container Manager — Mod list',
      'Server: Fabric Survival',
      'Minecraft: 1.21.1',
      'Server type: fabric',
      'Total mods: 2 (1 enabled, 1 disabled)',
      '',
      'Fabric API',
      '  Version: 0.100.0',
      '  File: fabric-api-0.100.0.jar',
      '  Status: Enabled',
      '  Source: Modrinth',
      '  Project: https://modrinth.com/mod/fabric-api',
      '',
      'Private mod',
      '  Version: Unknown',
      '  File: private.jar.disabled',
      '  Status: Disabled',
      '',
    ].join('\n'));
    expect(items.map((item) => item.name)).toEqual(['private', 'fabric-api']);
  });

  it('uses plugin labels and links to the original catalogs without guessing upload identities', () => {
    const result = createModListExport({ ...server, server_type: 'paper' }, {
      type: 'plugins', items: [
        { name: 'Chunky', file: 'Chunky.jar', enabled: true, provider: 'hangar', project_slug: 'pop4959/Chunky' },
        { name: 'LuckPerms', file: 'LuckPerms.jar', enabled: true, provider: 'spiget', project_id: '28140' },
        { name: 'WorldEdit', file: 'worldedit.jar', enabled: true, provider: 'curseforge', project_slug: 'worldedit' },
        { name: 'Custom', file: 'custom.jar', enabled: false },
      ],
    });

    expect(result.filename).toBe('Fabric-Survival-pluginlist.txt');
    expect(result.content).toContain('Minecraft Container Manager — Plugin list');
    expect(result.content).toContain('Total plugins: 4 (3 enabled, 1 disabled)');
    expect(result.content).toContain('Source: Hangar\n  Project: https://hangar.papermc.io/pop4959/Chunky');
    expect(result.content).toContain('Source: SpigotMC\n  Project: https://www.spigotmc.org/resources/28140');
    expect(result.content).toContain('Source: CurseForge\n  Project: https://www.curseforge.com/minecraft/bukkit-plugins/worldedit');
    expect(result.content.match(/ {2}Project:/g)).toHaveLength(3);
    expect(result.content).not.toContain('undefined');
  });

  it.each([
    ['  ../My: Server/\\?*  ', 'My-Server-modlist.txt'],
    ['世界 サーバー', '世界-サーバー-modlist.txt'],
    ['../', 'server-modlist.txt'],
    ['', 'server-modlist.txt'],
    ['x'.repeat(200), `${'x'.repeat(100)}-modlist.txt`],
  ])('creates a safe download filename for %s', (name, filename) => {
    expect(createModListExport({ ...server, name }, { type: 'mods', items: [] }).filename).toBe(filename);
  });

  it('keeps Unicode text, flattens multiline fields, and handles missing versions and empty lists', () => {
    const result = createModListExport({ ...server, name: '世界\nServer', version: '' }, {
      type: 'mods', items: [{ name: '名前\nMod', file: 'custom\tmod.jar', enabled: true }],
    });
    expect(result.content).toContain('Server: 世界 Server\nMinecraft: Unknown');
    expect(result.content).toContain('名前 Mod\n  Version: Unknown\n  File: custom mod.jar');
    expect(createModListExport(server, { type: 'mods', items: [] }).content).toContain('Total mods: 0 (0 enabled, 0 disabled)');
  });
});

describe('modlist download', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn<(blob: Blob) => string>().mockReturnValue('blob:modlist-export');
      static revokeObjectURL = vi.fn();
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('downloads a UTF-8 text file once and cleans up the anchor and object URL', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this).toHaveAttribute('download', 'Fabric-Survival-modlist.txt');
      expect(this).toHaveAttribute('href', 'blob:modlist-export');
      expect(this).toBeInTheDocument();
    });

    downloadModList(server, { type: 'mods', items: [] });

    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(vi.mocked(URL.createObjectURL).mock.calls[0][0]).toBeInstanceOf(Blob);
    expect((vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob).type).toBe('text/plain;charset=utf-8');
    expect(document.querySelector('a[download]')).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:modlist-export');
  });

  it('still cleans up if starting the download fails', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('Download blocked'); });

    expect(() => downloadModList(server, { type: 'plugins', items: [] })).toThrow('Download blocked');
    expect(document.querySelector('a[download]')).not.toBeInTheDocument();
    vi.runOnlyPendingTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:modlist-export');
  });
});
