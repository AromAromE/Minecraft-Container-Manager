import { getCurseForgeApiKey, getCurseForgeMods } from './curseforge';
import { getHangarProject } from './hangar';
import { getProjects } from './modrinth';
import { getSpigetIconUrl, getSpigetResource } from './spiget';
import type { Mod, ModProvider } from './types';

export const MOD_PROVIDER_LABELS: Record<ModProvider, string> = {
  modrinth: 'Modrinth',
  hangar: 'Hangar',
  spiget: 'SpigotMC',
  curseforge: 'CurseForge',
};

/** Resolve artwork for known catalog projects without guessing from jar filenames. */
export async function fetchInstalledModIcons(mods: Mod[]): Promise<Record<string, string>> {
  const icons: Record<string, string> = {};
  const requests: Promise<void>[] = [];
  const modrinthMods = mods.filter(
    (mod) => mod.provider === 'modrinth' && (mod.project_id || mod.project_slug),
  );
  const modrinthIds = [...new Set(modrinthMods.map((mod) => mod.project_id || mod.project_slug!))];

  // Batch large installed lists, sharing the catalog clients' cache and rate limits.
  for (let offset = 0; offset < modrinthIds.length; offset += 100) {
    requests.push(getProjects(modrinthIds.slice(offset, offset + 100)).then((projects) => {
      for (const mod of modrinthMods) {
        const id = mod.project_id || mod.project_slug;
        const project = projects.find((project) => project.id === id || project.slug === id);
        if (project?.icon_url) icons[mod.name] = project.icon_url;
      }
    }));
  }

  const curseforgeMods = mods.filter(
    (mod) => mod.provider === 'curseforge' && /^[1-9]\d*$/.test(mod.project_id ?? ''),
  );
  const apiKey = getCurseForgeApiKey();
  if (curseforgeMods.length > 0 && apiKey.trim()) {
    const ids = [...new Set(curseforgeMods.map((mod) => Number(mod.project_id)))];
    requests.push(getCurseForgeMods(ids, apiKey).then((projects) => {
      for (const mod of curseforgeMods) {
        const project = projects.find((project) => project.id === Number(mod.project_id));
        const icon = project?.logo?.thumbnailUrl || project?.logo?.url;
        if (icon) icons[mod.name] = icon;
      }
    }));
  }

  for (const mod of mods) {
    if (mod.provider === 'hangar') {
      const id = mod.project_slug || mod.project_id;
      if (id) {
        requests.push(getHangarProject(id).then((project) => {
          if (project.avatarUrl) icons[mod.name] = project.avatarUrl;
        }));
      }
    } else if (mod.provider === 'spiget' && /^[1-9]\d*$/.test(mod.project_id ?? '')) {
      requests.push(getSpigetResource(Number(mod.project_id)).then((project) => {
        const icon = getSpigetIconUrl(project);
        if (icon) icons[mod.name] = icon;
      }));
    }
  }

  // Artwork is optional: an unavailable provider must not hide the installed list.
  await Promise.allSettled(requests);
  return icons;
}
