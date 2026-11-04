/** Convert Docker-style CPU usage (100% per core) to a share of the whole host. */
export function hostCPUPercent(percent: number | null | undefined, cores: number | null | undefined): number | null {
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0) return null;
  if (percent === 0) return 0;
  if (typeof cores !== 'number' || !Number.isInteger(cores) || cores <= 0) return null;
  return Math.min(100, percent / cores);
}
