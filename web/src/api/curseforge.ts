import { rememberArtifactHashes } from './artifact-hashes';
import { request } from './client';
import { ensureCsrf } from './csrf';
import { clearRateLimitCache } from './rate-limited-fetch';
import type {
  CurseForgeCategory,
  CurseForgeDeployProgress,
  CurseForgeFile,
  CurseForgeMod,
  CurseForgeSearchResult,
  InstallCurseForgeServerInput,
  InstallCurseForgeServerResponse,
  Mod,
  ServerType,
} from './types';
import { extractModId } from './modrinth';
import { rateLimitedFetchJson } from './rate-limited-fetch';

export const CURSEFORGE_API_BASE = '/api/curseforge';
export const MINECRAFT_GAME_ID = 432;

export interface CurseForgeSettings {
  configured: boolean;
  source: 'database' | 'environment' | '';
}

export function getCurseForgeSettings(): Promise<CurseForgeSettings> {
  return request<CurseForgeSettings>(`${CURSEFORGE_API_BASE}/settings`);
}

export async function saveCurseForgeApiKey(key: string): Promise<CurseForgeSettings> {
  const settings = await request<CurseForgeSettings>(`${CURSEFORGE_API_BASE}/settings`, {
    method: 'PUT',
    body: JSON.stringify({ api_key: key.trim() }),
  });
  clearRateLimitCache();
  // Remove the old browser-only credential after explicitly saving the shared replacement.
  if (typeof window !== 'undefined') {
    localStorage.removeItem('mcm_curseforge_api_key');
    window.dispatchEvent(new Event('mcm:curseforge-settings'));
  }
  return settings;
}

/**
 * Maps server software type to CurseForge loader type ID.
 * 1 = Forge, 4 = Fabric, 5 = Quilt, 6 = NeoForge
 */
export function getCurseForgeLoaderType(serverType: ServerType): number | undefined {
  switch (serverType) {
    case 'forge':
      return 1;
    case 'fabric':
      return 4;
    case 'quilt':
      return 5;
    case 'neoforge':
      return 6;
    default:
      return undefined;
  }
}

export const CF_CLASS_MODS = 6;
export const CF_CLASS_PLUGINS = 5;
export const CF_CLASS_MODPACKS = 4471;

export function isPluginServerType(serverType: ServerType): boolean {
  return [
    'paper',
    'spigot',
    'purpur',
    'pufferfish',
    'leaf',
    'folia',
    'waterfall',
    'velocity',
    'bungeecord',
    'limbo',
    'nanolimbo',
    'geysermc',
  ].includes(serverType);
}

/**
 * Returns appropriate CurseForge classId: 6 for mods, 5 for plugins.
 */
export function getCurseForgeClassId(serverType: ServerType): number {
  if (isPluginServerType(serverType)) {
    return CF_CLASS_PLUGINS; // Bukkit Plugins
  }
  return CF_CLASS_MODS; // Mods
}

export const CF_SORT_OPTIONS: {
  id: number;
  label: string;
}[] = [
  { id: 2, label: 'Popularity' },
  { id: 6, label: 'Most Downloaded' },
  { id: 3, label: 'Recently Updated' },
  { id: 1, label: 'Featured' },
];

export interface CurseForgeSearchParams {
  query?: string;
  classId?: number;
  modLoaderType?: number;
  gameVersion?: string;
  sortField?: number;
  pageSize?: number;
  index?: number;
}

/**
 * Searches CurseForge mods or plugins.
 */
export async function searchCurseForge(
  params: CurseForgeSearchParams,
  signal?: AbortSignal,
): Promise<CurseForgeSearchResult> {
  const {
    query = '',
    classId = 6,
    modLoaderType,
    gameVersion,
    sortField = 6,
    pageSize = 20,
    index = 0,
  } = params;

  const searchParams = new URLSearchParams();
  searchParams.set('gameId', String(MINECRAFT_GAME_ID));
  searchParams.set('classId', String(classId));
  if (query.trim()) {
    searchParams.set('searchFilter', query.trim());
  }
  if (modLoaderType !== undefined) {
    searchParams.set('modLoaderType', String(modLoaderType));
  }
  if (gameVersion && gameVersion.trim()) {
    searchParams.set('gameVersion', gameVersion.trim());
  }
  searchParams.set('sortField', String(sortField));
  searchParams.set('sortOrder', 'desc');
  searchParams.set('pageSize', String(pageSize));
  searchParams.set('index', String(index));

  const url = `${CURSEFORGE_API_BASE}/mods/search?${searchParams.toString()}`;
  return rateLimitedFetchJson<CurseForgeSearchResult>(
    url,
    {
      headers: {
        Accept: 'application/json',
      },
    },
    {
      cacheTtlMs: 120000, // 2 minutes
      signal,
    },
  );
}

/**
 * Retrieves release files for a CurseForge mod.
 */
export async function getCurseForgeFiles(
  modId: number,
  options?: {
    gameVersion?: string;
    modLoaderType?: number;
    pageSize?: number;
  },
  signal?: AbortSignal,
): Promise<CurseForgeFile[]> {
  const searchParams = new URLSearchParams();
  if (options?.gameVersion) {
    searchParams.set('gameVersion', options.gameVersion);
  }
  if (options?.modLoaderType !== undefined) {
    searchParams.set('modLoaderType', String(options.modLoaderType));
  }
  searchParams.set('pageSize', String(options?.pageSize ?? 25));

  const query = searchParams.toString();
  const url = `${CURSEFORGE_API_BASE}/mods/${modId}/files?${query}`;

  const data = await rateLimitedFetchJson<{ data: CurseForgeFile[] }>(
    url,
    {
      headers: {
        Accept: 'application/json',
      },
    },
    {
      cacheTtlMs: 300000, // 5 minutes
      signal,
    },
  );

  const files=data.data??[];
 for(const file of files){const hashes:Record<string,string>={};for(const hash of file.hashes??[]){if(hash.algo===1)hashes.sha1=hash.value;else if(hash.algo===2)hashes.md5=hash.value;}rememberArtifactHashes(file.downloadUrl??undefined,hashes);}
 return files;
}

/**
 * Gets direct download URL for a CurseForge file, resolving edge URL if needed.
 */
export async function getCurseForgeDownloadUrl(
  modId: number,
  fileId: number,
  signal?: AbortSignal,
): Promise<string> {
  const url = `${CURSEFORGE_API_BASE}/mods/${modId}/files/${fileId}/download-url`;
  const data = await rateLimitedFetchJson<{ data: string }>(
    url,
    {
      headers: {
        Accept: 'application/json',
      },
    },
    {
      cacheTtlMs: 900000, // 15 minutes
      signal,
    },
  );
  return data.data;
}

/**
 * Checks if a CurseForge mod matches an installed mod.
 */
export function findInstalledCurseForgeMod(
  mod: Pick<CurseForgeMod, 'name' | 'slug'> & { id?: number },
  installedMods: Mod[],
): Mod | undefined {
  const targetSlug = mod.slug.toLowerCase().trim().replace(/_/g, '-');
  const targetName = mod.name.toLowerCase().trim().replace(/[\s_]+/g, '-');
  const targetIdStr = mod.id ? String(mod.id) : undefined;

  // 1. Exact catalog project match
  for (const m of installedMods) {
    if (targetIdStr && m.project_id && m.project_id === targetIdStr) {
      return m;
    }
    if (m.project_slug && m.project_slug.toLowerCase() === targetSlug) {
      return m;
    }
  }

  // 2. Canonical mod identifier from jar manifest
  for (const m of installedMods) {
    if (m.mod_id) {
      const cleanModId = m.mod_id.toLowerCase().trim().replace(/_/g, '-');
      if (cleanModId === targetSlug || cleanModId === targetName) {
        return m;
      }
      if (m.title) {
        const cleanModTitle = m.title.toLowerCase().trim().replace(/[\s_]+/g, '-');
        if (cleanModTitle === targetSlug || cleanModTitle === targetName) {
          return m;
        }
      }
      continue;
    }

    // 3. Exact match on raw filename or name
    const rawFile = m.file.replace(/\.jar(\.disabled)?$/i, '').toLowerCase();
    const rawName = m.name.toLowerCase();
    if (rawFile === targetSlug || rawName === targetSlug) {
      return m;
    }
    if (rawFile === targetName || rawName === targetName) {
      if (targetName === targetSlug || targetName.includes('-')) {
        return m;
      }
    }

    // 4. Filename mod identifier
    const fileModId = extractModId(m.file).replace(/_/g, '-');
    const nameModId = extractModId(m.name).replace(/_/g, '-');

    if (fileModId === targetSlug || nameModId === targetSlug) {
      return m;
    }

    if (targetName === targetSlug && fileModId === targetName) {
      return m;
    }
  }

  return undefined;
}

export function isCurseForgeModInstalled(
  mod: Pick<CurseForgeMod, 'name' | 'slug'>,
  installedMods: Mod[],
): boolean {
  return findInstalledCurseForgeMod(mod, installedMods) !== undefined;
}

/**
 * Retrieves multiple mods from CurseForge by their IDs in a single batch request.
 * Endpoint: POST /v1/mods
 */
export async function getCurseForgeMods(
  modIds: number[],
  signal?: AbortSignal,
): Promise<CurseForgeMod[]> {
  if (modIds.length === 0) return [];
  const url = `${CURSEFORGE_API_BASE}/mods`;
  try {
    const res = await rateLimitedFetchJson<{ data: CurseForgeMod[] }>(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ modIds }),
      },
      {
        cacheTtlMs: 300000,
        signal,
      },
    );
    return res.data ?? [];
  } catch {
    return [];
  }
}

export interface ModpackSearchParams {
  searchFilter?: string;
  gameVersion?: string;
  modLoaderType?: number;
  sortField?: number;
  sortOrder?: 'asc' | 'desc';
  pageSize?: number;
  index?: number;
  categoryId?: number;
}

/**
 * Searches CurseForge modpacks via MCM's backend proxy.
 */
export async function searchCurseForgeModpacks(
  params: ModpackSearchParams,
  signal?: AbortSignal,
): Promise<CurseForgeSearchResult> {
  const searchParams = new URLSearchParams();
  if (params.searchFilter?.trim()) {
    searchParams.set('searchFilter', params.searchFilter.trim());
  }
  if (params.gameVersion?.trim()) {
    searchParams.set('gameVersion', params.gameVersion.trim());
  }
  if (params.modLoaderType !== undefined && params.modLoaderType > 0) {
    searchParams.set('modLoaderType', String(params.modLoaderType));
  }
  if (params.categoryId !== undefined && params.categoryId > 0) {
    searchParams.set('categoryId', String(params.categoryId));
  }
  searchParams.set('sortField', String(params.sortField ?? 2));
  if (params.sortOrder) {
    searchParams.set('sortOrder', params.sortOrder);
  }
  searchParams.set('pageSize', String(params.pageSize ?? 20));
  searchParams.set('index', String(params.index ?? 0));

  const url = `/api/v1/curseforge/modpacks?${searchParams.toString()}`;
  return rateLimitedFetchJson<CurseForgeSearchResult>(
    url,
    { headers: { Accept: 'application/json' } },
    { cacheTtlMs: 60000, signal },
  );
}

/**
 * Retrieves release files for a modpack, specifically highlighting if a serverPackFileId exists.
 */
export async function getCurseForgeModpackFiles(
  modId: number,
  options?: {
    gameVersion?: string;
    modLoaderType?: number;
    pageSize?: number;
    index?: number;
  },
  signal?: AbortSignal,
): Promise<{ data: CurseForgeFile[]; pagination: { index: number; pageSize: number; totalCount: number } }> {
  const searchParams = new URLSearchParams();
  if (options?.gameVersion) {
    searchParams.set('gameVersion', options.gameVersion);
  }
  if (options?.modLoaderType !== undefined && options.modLoaderType > 0) {
    searchParams.set('modLoaderType', String(options.modLoaderType));
  }
  searchParams.set('pageSize', String(options?.pageSize ?? 25));
  if (options?.index) {
    searchParams.set('index', String(options.index));
  }

  const query = searchParams.toString();
  const url = `/api/v1/curseforge/modpacks/${modId}/files${query ? `?${query}` : ''}`;
  return rateLimitedFetchJson<{ data: CurseForgeFile[]; pagination: { index: number; pageSize: number; totalCount: number } }>(
    url,
    { headers: { Accept: 'application/json' } },
    { cacheTtlMs: 60000, signal },
  );
}

/**
 * Retrieves available categories for Minecraft modpacks.
 */
export async function getCurseForgeCategories(
  signal?: AbortSignal,
): Promise<CurseForgeCategory[]> {
  try {
    const res = await rateLimitedFetchJson<{ data: CurseForgeCategory[] }>(
      '/api/v1/curseforge/categories',
      { headers: { Accept: 'application/json' } },
      { cacheTtlMs: 600000, signal },
    );
    return res.data ?? [];
  } catch {
    return [];
  }
}

/**
 * Deploys a CurseForge server pack container, supporting streaming progress updates.
 */
export async function installCurseForgeServer(
  input: InstallCurseForgeServerInput,
  onProgress?: (progress: CurseForgeDeployProgress) => void,
  signal?: AbortSignal,
): Promise<InstallCurseForgeServerResponse> {
  const url = '/api/v1/curseforge/install-server';

  if (onProgress && typeof window !== 'undefined' && window.fetch) {
    try {
      const csrf = await ensureCsrf();
      const res = await fetch(`${url}?stream=true`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'X-MCM-CSRF': csrf,
        },
        body: JSON.stringify(input),
        signal,
      });

      if (!res.ok) {
        let errMessage = 'Failed to deploy server';
        try {
          const errData = await res.json();
          errMessage = errData.error || errData.message || errData.detail || errMessage;
        } catch {
          errMessage = (await res.text()) || errMessage;
        }
        throw new Error(errMessage);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('Response body unavailable');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let resultServer: InstallCurseForgeServerResponse | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEvent = 'message';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.slice(6).trim();
          } else if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim();
            try {
              const parsed = JSON.parse(dataStr);
              if (currentEvent === 'progress') {
                onProgress(parsed as CurseForgeDeployProgress);
              } else if (currentEvent === 'completed') {
                resultServer = parsed as InstallCurseForgeServerResponse;
              } else if (currentEvent === 'error') {
                throw new Error(parsed.error || 'Deployment failed');
              }
            } catch (err) {
              if (currentEvent === 'error') throw err;
            }
          }
        }
      }

      if (resultServer) {
        return resultServer;
      }
    } catch (streamErr) {
      // If user aborted, rethrow
      if (signal?.aborted) throw streamErr;
      // If error came from stream, rethrow
      if (streamErr instanceof Error && !streamErr.message.includes('fetch')) {
        throw streamErr;
      }
      // Otherwise fall through to standard POST
    }
  }

  return request<InstallCurseForgeServerResponse>(url, {
    method: 'POST',
    body: JSON.stringify(input),
    signal,
  });
}

