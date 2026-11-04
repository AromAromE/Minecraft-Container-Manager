declare const __MCM_BUILD_COMMIT__: string;

export const browserBuildCommit = typeof __MCM_BUILD_COMMIT__ === 'string' ? __MCM_BUILD_COMMIT__ : 'unknown';
export const browserBuildStorageKey = 'mcm-browser-build-commit';

// Keep the loaded bundle's identity in memory as well as storage. Another tab
// loading a newer build must not make this tab appear up to date.
export function rememberBrowserBuild() {
  try { window.localStorage.setItem(browserBuildStorageKey, browserBuildCommit); }
  catch { /* Storage may be disabled; build comparison still works. */ }
}

export function browserBuildNeedsRefresh(commit: string | null) {
  return !!commit && commit !== 'unknown' && browserBuildCommit !== 'unknown' && commit !== browserBuildCommit;
}

let panelBuildCommit: string | null = null;
const listeners = new Set<() => void>();

export function observePanelBuild(commit: string | null) {
  if (!commit || commit === 'unknown' || commit === panelBuildCommit) return;
  panelBuildCommit = commit;
  listeners.forEach((listener) => listener());
}

export function getPanelBuildCommit() { return panelBuildCommit; }

export function subscribePanelBuild(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function panelRefreshURL(commit: string, href = window.location.href) {
  const url = new URL(href);
  url.searchParams.set('_mcm_build', commit);
  url.searchParams.set('_mcm_reload', String(Date.now()));
  return url.href;
}

export function fullRefreshPanel(commit: string) {
  // There is no portable reload(true). A new document URL bypasses the old
  // cached HTML, which then loads Vite's content-hashed assets for this build.
  window.location.replace(panelRefreshURL(commit));
}
