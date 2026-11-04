import { getCurseForgeMods } from './curseforge';
import { getHangarProject } from './hangar';
import { getProject } from './modrinth';
import type { ModUpdateInfo } from './mod-updates';
import { getSpigetResource } from './spiget';
import type { Mod, ModList } from './types';

export interface InstalledModDetails {
  title: string;
  description: string;
  projectUrl: string;
  downloads: number;
  author?: string;
  license?: string;
  categories?: string[];
  sourceUrl?: string | null;
  wikiUrl?: string | null;
  issuesUrl?: string | null;
}

/** Use discovered metadata only when it belongs to the installed mod's catalog. */
export function resolveInstalledModMetadata(mod: Mod, update?: ModUpdateInfo): Mod {
  if (!update || (mod.provider && mod.provider !== update.provider)) return mod;
  return {
    ...mod,
    provider: mod.provider || update.provider,
    project_id: mod.project_id || update.projectId,
    project_slug: mod.project_slug || update.projectSlug,
    title: mod.title || update.title,
    version: mod.version || update.currentVersion,
  };
}

/** Do not guess project identities from uploaded jar names or mod IDs. */
export function getInstalledModProjectUrl(mod: Mod, type: ModList['type']): string | undefined {
  const id = mod.project_slug || mod.project_id;
  if (!id) return;
  switch (mod.provider) {
    case 'modrinth':
      return `https://modrinth.com/${type === 'plugins' ? 'plugin' : 'mod'}/${encodeURIComponent(id)}`;
    case 'hangar': {
      // Hangar's website needs an owner as well as a slug; otherwise resolve it via its API.
      const parts = mod.project_slug?.split('/');
      if (parts?.length === 2 && parts.every(Boolean)) {
        return `https://hangar.papermc.io/${parts.map(encodeURIComponent).join('/')}`;
      }
      return;
    }
    case 'spiget':
      if (/^[1-9]\d*$/.test(mod.project_id ?? '')) {
        return `https://www.spigotmc.org/resources/${mod.project_id}`;
      }
      return;
    case 'curseforge':
      if (mod.project_slug) {
        return `https://www.curseforge.com/minecraft/${type === 'plugins' ? 'bukkit-plugins' : 'mc-mods'}/${encodeURIComponent(mod.project_slug)}`;
      }
      if (/^[1-9]\d*$/.test(mod.project_id ?? '')) {
        return `https://www.curseforge.com/projects/${mod.project_id}`;
      }
  }
}

/** Fetch extra information on demand, reusing the catalog clients' caches and rate limits. */
export async function fetchInstalledModDetails(
  mod: Mod,
  type: ModList['type'],
  signal?: AbortSignal,
): Promise<InstalledModDetails | null> {
  switch (mod.provider) {
    case 'modrinth': {
      const id = mod.project_id || mod.project_slug;
      if (!id) return null;
      const project = await getProject(id, signal);
      return {
        title: project.title,
        description: project.description,
        projectUrl: `https://modrinth.com/${encodeURIComponent(project.project_type || (type === 'plugins' ? 'plugin' : 'mod'))}/${encodeURIComponent(project.slug || id)}`,
        downloads: project.downloads,
        license: project.license?.name,
        categories: project.categories,
        sourceUrl: project.source_url,
        wikiUrl: project.wiki_url,
        issuesUrl: project.issues_url,
      };
    }
    case 'hangar': {
      const id = mod.project_slug || mod.project_id;
      if (!id) return null;
      const project = await getHangarProject(id, signal);
      return {
        title: project.name,
        description: project.description,
        projectUrl: `https://hangar.papermc.io/${encodeURIComponent(project.namespace.owner)}/${encodeURIComponent(project.namespace.slug)}`,
        downloads: project.stats.downloads,
        author: project.namespace.owner,
        categories: [project.category],
      };
    }
    case 'spiget': {
      if (!/^[1-9]\d*$/.test(mod.project_id ?? '')) return null;
      const project = await getSpigetResource(Number(mod.project_id), signal);
      return {
        title: project.name,
        description: project.tag,
        projectUrl: `https://www.spigotmc.org/resources/${project.id}`,
        downloads: project.downloads,
        author: project.author.name,
        sourceUrl: project.links?.sourceCode,
      };
    }
    case 'curseforge': {
      if (!/^[1-9]\d*$/.test(mod.project_id ?? '')) return null;
      const projects = await getCurseForgeMods([Number(mod.project_id)], signal);
      const project = projects.find((item) => item.id === Number(mod.project_id));
      if (!project) throw new Error('CurseForge project details are unavailable.');
      return {
        title: project.name,
        description: project.summary,
        projectUrl: project.links.websiteUrl || getInstalledModProjectUrl(mod, type)!,
        downloads: project.downloadCount,
        author: project.authors.map((author) => author.name).join(', '),
        categories: project.categories.map((category) => category.name),
        sourceUrl: project.links.sourceUrl,
        wikiUrl: project.links.wikiUrl,
        issuesUrl: project.links.issuesUrl,
      };
    }
    default:
      return null;
  }
}
