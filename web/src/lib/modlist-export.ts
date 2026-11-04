import { getInstalledModProjectUrl } from '../api/mod-details';
import { MOD_PROVIDER_LABELS } from '../api/mod-icons';
import type { ModList, Server } from '../api/types';

type ExportServer = Pick<Server, 'name' | 'server_type' | 'version'>;

const singleLine = (value: string) => value.replace(/\s+/g, ' ').trim();

export function createModListExport(server: ExportServer, list: ModList) {
  const isMods = list.type === 'mods';
  const enabled = list.items.filter((item) => item.enabled).length;
  const lines = [
    `Minecraft Container Manager — ${isMods ? 'Mod' : 'Plugin'} list`,
    `Server: ${singleLine(server.name)}`,
    `Minecraft: ${singleLine(server.version) || 'Unknown'}`,
    `Server type: ${server.server_type}`,
    `Total ${list.type}: ${list.items.length} (${enabled} enabled, ${list.items.length - enabled} disabled)`,
  ];

  const sorted = [...list.items].sort((a, b) =>
    (a.title || a.name).localeCompare(b.title || b.name, undefined, { sensitivity: 'base', numeric: true }),
  );
  for (const item of sorted) {
    lines.push(
      '',
      singleLine(item.title || item.name),
      `  Version: ${singleLine(item.version || '') || 'Unknown'}`,
      `  File: ${singleLine(item.file)}`,
      `  Status: ${item.enabled ? 'Enabled' : 'Disabled'}`,
    );
    if (item.provider) lines.push(`  Source: ${MOD_PROVIDER_LABELS[item.provider]}`);
    const projectUrl = getInstalledModProjectUrl(item, list.type);
    if (projectUrl) lines.push(`  Project: ${projectUrl}`);
  }

  const serverName = server.name.trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 100) || 'server';

  return {
    filename: `${serverName}-${isMods ? 'modlist' : 'pluginlist'}.txt`,
    content: `${lines.join('\n')}\n`,
  };
}

export function downloadModList(server: ExportServer, list: ModList): void {
  const { filename, content } = createModListExport(server, list);
  const anchor = document.createElement('a');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  try {
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // Give the browser time to start reading the download before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}
