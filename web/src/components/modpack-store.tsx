import { useCallback, useEffect, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Server,
  Settings2,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { api } from '../api/client';
import {
  getCurseForgeCategories,
  getCurseForgeModpackFiles,
  installCurseForgeServer,
  searchCurseForgeModpacks,
} from '../api/curseforge';
import { formatCount, formatFileSize } from '../api/modrinth';
import type {
  AvailablePortsResponse,
  CurseForgeCategory,
  CurseForgeDeployProgress,
  CurseForgeFile,
  CurseForgeMod,
  InstallCurseForgeServerResponse,
  Server as MCServer,
} from '../api/types';
import { usePermissions } from '../lib/auth';
import { useCurseForgeSettings } from '../lib/curseforge';
import { CurseForgeSettings } from './curseforge-settings';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { DialogBackdrop } from './ui/dialog-backdrop';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { ProgressBar } from './ui/progress';
import { Select } from './ui/select';
import { Skeleton } from './ui/skeleton';

// Predefined popular Minecraft versions for quick filtering
const POPULAR_MC_VERSIONS = [
  '1.21.4',
  '1.21.1',
  '1.21',
  '1.20.6',
  '1.20.4',
  '1.20.2',
  '1.20.1',
  '1.19.4',
  '1.19.2',
  '1.18.2',
  '1.16.5',
  '1.12.2',
  '1.7.10',
];

const MODLOADER_OPTIONS = [
  { id: 0, label: 'All Modloaders' },
  { id: 1, label: 'Forge' },
  { id: 4, label: 'Fabric' },
  { id: 6, label: 'NeoForge' },
  { id: 5, label: 'Quilt' },
];

const SORT_OPTIONS = [
  { id: 6, label: 'Popularity (Total Downloads)' },
  { id: 2, label: 'Popularity (Featured)' },
  { id: 3, label: 'Recently Updated' },
  { id: 4, label: 'Name (A-Z)' },
];

const RAM_PRESETS = [
  { mb: 4096, label: '4 GB', desc: 'Lightweight / Vanilla+' },
  { mb: 6144, label: '6 GB', desc: 'Standard Modpack' },
  { mb: 8192, label: '8 GB', desc: 'Recommended for Heavy Modpacks', recommended: true },
  { mb: 10240, label: '10 GB', desc: 'Large Multiplayer' },
  { mb: 12288, label: '12 GB', desc: 'Ultra Modpacks (ATM9)' },
  { mb: 16384, label: '16 GB', desc: 'Maximum Performance' },
];

export function ModpackStore() {
  const can = usePermissions();
  const { settings: cfSettings, loading: cfLoading, refresh: refreshCfSettings } = useCurseForgeSettings();

  // Search & Filter state
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [gameVersion, setGameVersion] = useState<string>('');
  const [modLoaderType, setModLoaderType] = useState<number>(0);
  const [categoryId, setCategoryId] = useState<number>(0);
  const [sortField, setSortField] = useState<number>(6); // Default: Total Downloads
  const [pageSize] = useState<number>(18);
  const [pageIndex, setPageIndex] = useState<number>(0);

  // Data state
  const [categories, setCategories] = useState<CurseForgeCategory[]>([]);
  const [modpacks, setModpacks] = useState<CurseForgeMod[] | null>(null);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Install Modal state
  const [selectedModpack, setSelectedModpack] = useState<CurseForgeMod | null>(null);
  const [showConfigSettings, setShowConfigSettings] = useState<boolean>(false);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      setPageIndex(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Reset page index on filter change
  useEffect(() => {
    setPageIndex(0);
  }, [gameVersion, modLoaderType, categoryId, sortField]);

  // Load categories
  useEffect(() => {
    if (!cfSettings?.configured) return;
    let cancelled = false;
    getCurseForgeCategories()
      .then((cats) => {
        if (!cancelled) setCategories(cats);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cfSettings?.configured]);

  // Execute modpack search
  const fetchModpacks = useCallback(async () => {
    if (!cfSettings?.configured) {
      setModpacks([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await searchCurseForgeModpacks({
        searchFilter: debouncedQuery,
        gameVersion: gameVersion || undefined,
        modLoaderType: modLoaderType > 0 ? modLoaderType : undefined,
        categoryId: categoryId > 0 ? categoryId : undefined,
        sortField,
        sortOrder: sortField === 4 ? 'asc' : 'desc',
        pageSize,
        index: pageIndex,
      });

      setModpacks(res.data ?? []);
      setTotalCount(res.pagination?.totalCount ?? 0);
    } catch (err) {
      setModpacks([]);
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to search CurseForge modpacks. Please check your API key configuration.',
      );
    } finally {
      setLoading(false);
    }
  }, [cfSettings?.configured, debouncedQuery, gameVersion, modLoaderType, categoryId, sortField, pageSize, pageIndex]);

  useEffect(() => {
    void fetchModpacks();
  }, [fetchModpacks]);

  const totalPages = Math.ceil(totalCount / pageSize);
  const currentPage = Math.floor(pageIndex / pageSize) + 1;

  return (
    <div className="space-y-6">
      {/* Page Heading */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight">CurseForge Modpack Store</h1>
            <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-xs font-medium">
              CurseForge Official
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse popular modpacks and deploy dedicated one-click server containers with automated runtime setup.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {can('settings.manage') && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowConfigSettings(true)}
              className="gap-1.5 text-xs"
            >
              <Settings2 className="h-3.5 w-3.5" />
              CurseForge Key
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchModpacks()}
            disabled={loading || !cfSettings?.configured}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Unconfigured Alert Banner */}
      {!cfLoading && !cfSettings?.configured && (
        <Card className="border-amber-500/40 bg-amber-500/10 text-foreground">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <h3 className="font-semibold text-amber-900 dark:text-amber-200">
                  CurseForge API Key Required
                </h3>
                <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-300/90">
                  A free CurseForge Eternal API key is required to query the modpack catalog and download server distributions.
                  Once configured, it is securely stored on the MCM server and shared across all sessions.
                </p>
              </div>
            </div>
            {can('settings.manage') ? (
              <Button
                variant="default"
                size="sm"
                onClick={() => setShowConfigSettings(true)}
                className="gap-1.5 shrink-0"
              >
                <Settings2 className="h-4 w-4" />
                Configure Key Now
              </Button>
            ) : (
              <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                Contact your MCM administrator to enable CurseForge integration.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Search and Filters Bar */}
      <div className="rounded-2xl border border-border/70 bg-card/75 p-4 shadow-xs sm:p-5 dark:bg-card/40">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          {/* Search Input */}
          <div className="relative md:col-span-5 lg:col-span-4">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search modpacks (e.g. All the Mods, ATM9, Better MC, RLCraft)..."
              className="pl-9 pr-9"
              aria-label="Search modpacks"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-2.5 rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Modloader Select */}
          <div className="md:col-span-3 lg:col-span-2">
            <Select
              value={modLoaderType}
              onValueChange={(val) => setModLoaderType(Number(val))}
              aria-label="Modloader filter"
            >
              {MODLOADER_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>

          {/* Minecraft Version Select */}
          <div className="md:col-span-4 lg:col-span-2">
            <Select
              value={gameVersion}
              onValueChange={(val) => setGameVersion(val)}
              aria-label="Game version filter"
            >
              <option value="">All Versions</option>
              {POPULAR_MC_VERSIONS.map((ver) => (
                <option key={ver} value={ver}>
                  MC {ver}
                </option>
              ))}
            </Select>
          </div>

          {/* Category Select */}
          <div className="md:col-span-6 lg:col-span-2">
            <Select
              value={categoryId}
              onValueChange={(val) => setCategoryId(Number(val))}
              aria-label="Category filter"
            >
              <option value={0}>All Categories</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </Select>
          </div>

          {/* Sort By Select */}
          <div className="md:col-span-6 lg:col-span-2">
            <Select
              value={sortField}
              onValueChange={(val) => setSortField(Number(val))}
              aria-label="Sort order"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* Active Filters Summary */}
        {(debouncedQuery || gameVersion || modLoaderType > 0 || categoryId > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3 text-xs">
            <span className="text-muted-foreground">Active filters:</span>
            {debouncedQuery && (
              <Badge variant="secondary" className="gap-1 font-normal">
                Keyword: "{debouncedQuery}"
                <button type="button" onClick={() => setQuery('')} className="ml-1 hover:text-foreground">
                  ×
                </button>
              </Badge>
            )}
            {modLoaderType > 0 && (
              <Badge variant="secondary" className="gap-1 font-normal">
                Loader: {MODLOADER_OPTIONS.find((o) => o.id === modLoaderType)?.label}
                <button type="button" onClick={() => setModLoaderType(0)} className="ml-1 hover:text-foreground">
                  ×
                </button>
              </Badge>
            )}
            {gameVersion && (
              <Badge variant="secondary" className="gap-1 font-normal">
                Version: {gameVersion}
                <button type="button" onClick={() => setGameVersion('')} className="ml-1 hover:text-foreground">
                  ×
                </button>
              </Badge>
            )}
            {categoryId > 0 && (
              <Badge variant="secondary" className="gap-1 font-normal">
                Category: {categories.find((c) => c.id === categoryId)?.name}
                <button type="button" onClick={() => setCategoryId(0)} className="ml-1 hover:text-foreground">
                  ×
                </button>
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQuery('');
                setGameVersion('');
                setModLoaderType(0);
                setCategoryId(0);
              }}
              className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Reset all
            </Button>
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <p>{error}</p>
          <Button variant="outline" size="sm" onClick={() => void fetchModpacks()} disabled={loading}>
            Try again
          </Button>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && modpacks === null && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border/70 bg-card/60 p-5 space-y-4">
              <div className="flex gap-4">
                <Skeleton className="h-16 w-16 rounded-2xl shrink-0" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-3.5 w-1/2" />
                  <div className="flex gap-1.5 pt-1">
                    <Skeleton className="h-4 w-14 rounded-md" />
                    <Skeleton className="h-4 w-16 rounded-md" />
                  </div>
                </div>
              </div>
              <Skeleton className="h-9 w-full rounded-md" />
              <div className="flex justify-between items-center pt-2 border-t border-border/40">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-28 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && modpacks !== null && modpacks.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed p-12 text-center">
          <Package className="h-12 w-12 text-muted-foreground/60" strokeWidth={1.5} />
          <h3 className="mt-4 text-base font-semibold">No Modpacks Found</h3>
          <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
            {cfSettings?.configured
              ? 'Try relaxing your search terms, choosing another Minecraft version, or clearing the modloader filter.'
              : 'Please configure your CurseForge API key to browse the modpack catalog.'}
          </p>
          {(debouncedQuery || gameVersion || modLoaderType > 0 || categoryId > 0) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQuery('');
                setGameVersion('');
                setModLoaderType(0);
                setCategoryId(0);
              }}
              className="mt-4"
            >
              Reset Filters
            </Button>
          )}
        </div>
      )}

      {/* Modpack Cards Grid */}
      {modpacks !== null && modpacks.length > 0 && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {modpacks.map((mod) => (
              <ModpackCard
                key={mod.id}
                mod={mod}
                canDeploy={can('servers.create')}
                onInstall={() => setSelectedModpack(mod)}
              />
            ))}
          </div>

          {/* Pagination Controls */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-4">
            <span className="text-xs text-muted-foreground">
              Showing <strong className="text-foreground">{modpacks.length}</strong> of{' '}
              <strong className="text-foreground">{totalCount.toLocaleString()}</strong> modpacks
            </span>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPageIndex((prev) => Math.max(0, prev - pageSize))}
                disabled={pageIndex === 0 || loading}
                className="gap-1 text-xs"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Previous
              </Button>
              <span className="px-2 text-xs font-medium text-muted-foreground">
                Page {currentPage} of {totalPages || 1}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPageIndex((prev) => prev + pageSize)}
                disabled={pageIndex + pageSize >= totalCount || loading}
                className="gap-1 text-xs"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Install Server Pack Modal */}
      {selectedModpack && (
        <InstallModpackModal
          mod={selectedModpack}
          onClose={() => setSelectedModpack(null)}
        />
      )}

      {/* Settings Dialog for API Key */}
      {showConfigSettings && (
        <DialogBackdrop
          onDismiss={() => setShowConfigSettings(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowConfigSettings(false);
          }}
        >
          <div className="w-full max-w-lg rounded-2xl border bg-card p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b">
              <div className="flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-bold">CurseForge Settings</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowConfigSettings(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4">
              <CurseForgeSettings
                onSaved={() => {
                  void refreshCfSettings();
                  setShowConfigSettings(false);
                  void fetchModpacks();
                }}
              />
            </div>
          </div>
        </DialogBackdrop>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modpack Card
// ---------------------------------------------------------------------------

function getLoaderBadgeClass(loader: string): string {
  switch (loader.toLowerCase()) {
    case 'neoforge':
      return 'border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400';
    case 'fabric':
      return 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400';
    case 'forge':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400';
    case 'quilt':
      return 'border-purple-500/40 bg-purple-500/10 text-purple-600 dark:text-purple-400';
    default:
      return 'border-primary/30 bg-primary/5 text-primary';
  }
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

interface ModpackCardProps {
  mod: CurseForgeMod;
  canDeploy: boolean;
  onInstall: () => void;
}

function ModpackCard({ mod, canDeploy, onInstall }: ModpackCardProps) {
  const [imgError, setImgError] = useState(false);

  const authorName = mod.authors?.[0]?.name || 'Unknown Author';
  const logoUrl = !imgError && (mod.logo?.thumbnailUrl || mod.logo?.url);

  // Extract MC version
  const latestFile = mod.latestFiles?.[0];
  const mcVersion =
    mod.latestVersionTag ||
    latestFile?.gameVersions?.find((v) => /^\d+\.\d+(\.\d+)?$/.test(v));

  // Extract loader tags (deduplicated)
  const loaderTags = Array.from(
    new Set(
      mod.latestFiles
        ?.flatMap((f) => f.gameVersions || [])
        .filter((v) => ['NeoForge', 'Forge', 'Fabric', 'Quilt'].includes(v)) || [],
    ),
  );
  if (loaderTags.length === 0 && latestFile?.gameVersions) {
    const fallbackLoader = latestFile.gameVersions.find((v) =>
      ['Forge', 'Fabric', 'NeoForge', 'Quilt'].includes(v),
    );
    if (fallbackLoader) loaderTags.push(fallbackLoader);
  }

  // Check if any recent file has a server pack
  const hasServerPack = Boolean(
    mod.latestFiles?.some((f) => f.hasServerPack || (f.serverPackFileId && f.serverPackFileId > 0)),
  );

  const curseforgeUrl =
    mod.links?.websiteUrl || `https://www.curseforge.com/minecraft/modpacks/${mod.slug}`;

  return (
    <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border/70 bg-card/75 p-5 shadow-xs transition-all duration-300 hover:-translate-y-1 hover:border-orange-500/40 hover:bg-card hover:shadow-xl dark:bg-card/40">
      {/* Top subtle brand accent line on hover */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-orange-500/0 via-orange-500/70 to-amber-500/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

      <div>
        {/* Top Header: Logo + Title + Badges */}
        <div className="flex items-start gap-4">
          {/* Modpack Icon with subtle zoom & shadow */}
          <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border/60 bg-secondary/40 shadow-xs transition-all duration-300 group-hover:scale-105 group-hover:shadow-md">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={mod.name}
                onError={() => setImgError(true)}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <Package className="h-8 w-8 text-muted-foreground/50" strokeWidth={1.5} />
            )}
          </div>

          {/* Title, Author, External Link */}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-1">
              <h3
                className="line-clamp-1 text-base font-bold text-foreground transition-colors group-hover:text-orange-500 dark:group-hover:text-orange-400"
                title={mod.name}
              >
                {mod.name}
              </h3>
              <a
                href={curseforgeUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-md p-1 text-muted-foreground/50 transition-colors hover:bg-secondary hover:text-foreground"
                title="View on CurseForge"
                aria-label="View on CurseForge"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>

            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              by <span className="font-medium text-foreground/85">{authorName}</span>
            </p>

            {/* Version & Loader Chips */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {mcVersion && (
                <Badge variant="secondary" className="px-2 py-0 text-[10px] font-mono font-semibold">
                  MC {mcVersion}
                </Badge>
              )}
              {loaderTags.map((loader) => (
                <Badge
                  key={loader}
                  variant="outline"
                  className={`px-2 py-0 text-[10px] font-medium ${getLoaderBadgeClass(loader)}`}
                >
                  {loader}
                </Badge>
              ))}
              {hasServerPack && (
                <Badge
                  variant="outline"
                  className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 gap-1 text-[10px] font-semibold px-2 py-0"
                  title="Official server pack files are available for 1-click deployment"
                >
                  <Zap className="h-2.5 w-2.5 fill-emerald-500 text-emerald-500" />
                  Server Pack
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Summary Description with consistent min-height */}
        <p className="mt-3.5 line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-muted-foreground">
          {mod.summary || 'No description provided.'}
        </p>

        {/* Categories preview */}
        {mod.categories && mod.categories.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 overflow-hidden">
            {mod.categories.slice(0, 3).map((cat) => (
              <span
                key={cat.id}
                className="inline-flex items-center rounded-md bg-secondary/80 px-2 py-0.5 text-[10px] font-medium text-secondary-foreground/80 transition-colors hover:bg-secondary"
              >
                {cat.name}
              </span>
            ))}
            {mod.categories.length > 3 && (
              <span className="self-center text-[10px] font-medium text-muted-foreground/70">
                +{mod.categories.length - 3} more
              </span>
            )}
          </div>
        )}
      </div>

      {/* Bottom Actions Bar */}
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/50 pt-3.5">
        <div className="flex flex-col gap-0.5">
          <div
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title={`${mod.downloadCount.toLocaleString()} total downloads`}
          >
            <Download className="h-3.5 w-3.5 text-muted-foreground/70" />
            <span className="font-semibold text-foreground">{formatCount(mod.downloadCount)}</span>
            <span className="hidden sm:inline text-[11px] text-muted-foreground/60">downloads</span>
          </div>
          {mod.dateModified && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
              <Clock className="h-2.5 w-2.5" />
              <span>{formatDate(mod.dateModified)}</span>
            </div>
          )}
        </div>

        <Button
          size="sm"
          onClick={onInstall}
          disabled={!canDeploy}
          className="gap-1.5 h-8 px-3.5 text-xs font-semibold shadow-xs transition-all duration-150 hover:shadow-md bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          <Server className="h-3.5 w-3.5" />
          Install Server
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Install Server" Modal
// ---------------------------------------------------------------------------

interface InstallModpackModalProps {
  mod: CurseForgeMod;
  onClose: () => void;
}

export function InstallModpackModal({ mod, onClose }: InstallModpackModalProps) {
  const router = useRouter();

  // Loading release files
  const [loadingFiles, setLoadingFiles] = useState<boolean>(true);
  const [files, setFiles] = useState<CurseForgeFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);

  // Server configuration inputs
  const [serverName, setServerName] = useState<string>(`${mod.name} Server`);
  const [ramMb, setRamMb] = useState<number>(8192); // 8GB recommended default
  const [port, setPort] = useState<string>('25565');
  const [usedPorts, setUsedPorts] = useState<Record<number, string>>({});
  const [loadingPorts, setLoadingPorts] = useState<boolean>(true);

  // Deployment status
  const [deploying, setDeploying] = useState<boolean>(false);
  const [progress, setProgress] = useState<CurseForgeDeployProgress | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployedResult, setDeployedResult] = useState<InstallCurseForgeServerResponse | null>(null);

  // Fetch release files for this modpack
  useEffect(() => {
    let cancelled = false;
    setLoadingFiles(true);
    getCurseForgeModpackFiles(mod.id, { pageSize: 50 })
      .then((res) => {
        if (cancelled) return;
        const availableFiles = res.data ?? [];
        setFiles(availableFiles);

        // Auto-select latest release file with server pack, or first available
        const defaultFile =
          availableFiles.find((f) => f.hasServerPack || (f.serverPackFileId && f.serverPackFileId > 0)) ||
          availableFiles[0];

        if (defaultFile) {
          setSelectedFileId(defaultFile.id);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setDeployError(err instanceof Error ? err.message : 'Failed to retrieve modpack versions');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingFiles(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mod.id]);

  // Fetch available and occupied ports
  useEffect(() => {
    let cancelled = false;
    setLoadingPorts(true);

    Promise.all([api.availablePorts(), api.listServers()])
      .then(([portsRes, serversRes]: [AvailablePortsResponse, MCServer[]]) => {
        if (cancelled) return;
        const portMap: Record<number, string> = {};

        // Track ports from active servers
        for (const s of serversRes) {
          if (s.host_port > 0) {
            portMap[s.host_port] = s.name;
          }
          for (const ep of s.extra_ports ?? []) {
            if (ep.host_port > 0) {
              portMap[ep.host_port] = `${s.name} (${ep.description || 'extra'})`;
            }
          }
        }

        // Track ports from port pool
        for (const u of portsRes.used ?? []) {
          if (u.port > 0 && !portMap[u.port]) {
            portMap[u.port] = u.server_name || 'Another server';
          }
        }

        setUsedPorts(portMap);

        // Pick free default port: 25565 if free, otherwise first available
        if (portMap[25565]) {
          const nextFree = portsRes.available?.find((p) => p !== 25565 && !portMap[p]);
          if (nextFree) {
            setPort(String(nextFree));
          } else {
            // Find next unassigned port above 25565
            let candidate = 25566;
            while (portMap[candidate] && candidate < 65000) {
              candidate++;
            }
            setPort(String(candidate));
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingPorts(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const parsedPort = parseInt(port.trim(), 10);
  const isPortInvalid = isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535;
  const portConflictServer = !isNaN(parsedPort) ? usedPorts[parsedPort] : undefined;

  const selectedFile = files.find((f) => f.id === selectedFileId);
  const hasDedicatedServerPack =
    selectedFile?.hasServerPack || (selectedFile?.serverPackFileId && selectedFile.serverPackFileId > 0);

  // Handle Deploy Action
  async function handleDeploy() {
    if (!selectedFileId) {
      setDeployError('Please select a modpack file version.');
      return;
    }
    if (!serverName.trim()) {
      setDeployError('Please provide a server name.');
      return;
    }
    if (isPortInvalid) {
      setDeployError('Please provide a valid port number between 1 and 65535.');
      return;
    }
    if (portConflictServer) {
      setDeployError(`Port ${parsedPort} is already occupied by "${portConflictServer}".`);
      return;
    }

    setDeploying(true);
    setDeployError(null);
    setProgress({
      stage: 'init',
      title: 'Preparing deployment',
      message: 'Contacting CurseForge and preparing storage...',
      percent: 5,
    });

    try {
      const memoryLimitStr = `${Math.round(ramMb / 1024)}GB`;

      const result = await installCurseForgeServer(
        {
          modId: mod.id,
          fileId: selectedFileId,
          serverName: serverName.trim(),
          memoryLimit: memoryLimitStr,
          port: parsedPort,
        },
        (p) => {
          setProgress(p);
        },
      );

      setDeployedResult(result);
    } catch (err: unknown) {
      let msg = 'Deployment failed. Please check the logs or try another version.';
      if (err instanceof Error) {
        msg = err.message;
      } else if (typeof err === 'string') {
        msg = err;
      } else if (typeof err === 'object' && err !== null) {
        const obj = err as Record<string, unknown>;
        if (typeof obj.message === 'string') msg = obj.message;
        else if (typeof obj.detail === 'string') msg = obj.detail;
        else if (typeof obj.error === 'string') msg = obj.error;
      }
      if (msg === '[object Object]' || !msg) {
        msg = 'Deployment failed. Please check server logs and configuration.';
      }
      setDeployError(msg);
    } finally {
      setDeploying(false);
    }
  }

  return (
    <DialogBackdrop
      onDismiss={() => {
        if (!deploying) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !deploying) onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border bg-card shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-secondary/50">
              {mod.logo?.thumbnailUrl ? (
                <img src={mod.logo.thumbnailUrl} alt={mod.name} className="h-full w-full object-cover" />
              ) : (
                <Package className="h-5 w-5 text-primary" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold truncate">Deploy {mod.name}</h2>
              <p className="text-xs text-muted-foreground truncate">
                by {mod.authors?.[0]?.name || 'CurseForge'} · Automated Sibling Docker Container
              </p>
            </div>
          </div>

          {!deploying && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Close dialog"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Success State */}
          {deployedResult ? (
            <div className="space-y-6 py-4 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-10 w-10" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-foreground">Server Container Deployed!</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  <strong>{deployedResult.name}</strong> has been extracted and started on port{' '}
                  <strong>{parsedPort}</strong>.
                </p>
              </div>

              <div className="rounded-xl border bg-secondary/30 p-4 text-left text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Server Name:</span>
                  <span className="font-semibold">{deployedResult.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Container Runtime:</span>
                  <span className="font-mono">eclipse-temurin (Java 17/21)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Memory Allocated:</span>
                  <span className="font-semibold">{Math.round(ramMb / 1024)} GB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Game Port:</span>
                  <span className="font-mono font-semibold">{parsedPort}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">EULA Agreement:</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Accepted (eula=true)</span>
                </div>
              </div>

              <div className="flex flex-wrap justify-center gap-3 pt-2">
                <Button
                  variant="default"
                  onClick={() => {
                    onClose();
                    void router.navigate({
                      to: '/servers/$id',
                      params: { id: deployedResult.server?.id || deployedResult.id },
                    });
                  }}
                  className="gap-2"
                >
                  <Server className="h-4 w-4" />
                  Open Server Console
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    onClose();
                    void router.navigate({ to: '/dashboard' });
                  }}
                >
                  Go to Dashboard
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Deploy Progress Bar (Active Deployment) */}
              {deploying && (
                <div className="space-y-4 rounded-xl border border-primary/30 bg-primary/5 p-5">
                  <div className="flex items-center gap-3">
                    <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
                    <div>
                      <h4 className="text-sm font-bold text-foreground">
                        {progress?.title || 'Deploying Modpack Container...'}
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        {progress?.message || 'Processing server files and initializing runtime container...'}
                      </p>
                    </div>
                  </div>

                  <ProgressBar
                    value={progress?.percent ?? 15}
                    animated
                    variant="default"
                    size="md"
                    label={<span className="text-xs font-semibold">{progress?.stage?.toUpperCase() || 'DEPLOYING'}</span>}
                  />

                  <p className="text-[11px] text-muted-foreground/80">
                    This step downloads the official server pack archive, normalizes Linux startup scripts, writes
                    the EULA, and launches the isolated Docker container runtime.
                  </p>
                </div>
              )}

              {/* Error Alert */}
              {deployError && (
                <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-xs text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold">Deployment Failed</p>
                    <p className="mt-0.5">{deployError}</p>
                  </div>
                </div>
              )}

              {/* Form Controls (Disabled while deploying) */}
              <div className={`space-y-5 ${deploying ? 'pointer-events-none opacity-50' : ''}`}>
                {/* 1. Modpack File Version Selection */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="modpack-version-select" className="text-xs font-semibold">
                      Server Pack Version
                    </Label>
                    {hasDedicatedServerPack && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        <Check className="h-3 w-3" /> Server Pack Available
                      </span>
                    )}
                  </div>

                  {loadingFiles ? (
                    <Skeleton className="h-10 w-full rounded-md" />
                  ) : files.length === 0 ? (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                      No server distribution files found for this modpack.
                    </div>
                  ) : (
                    <Select
                      id="modpack-version-select"
                      value={selectedFileId ?? ''}
                      onValueChange={(val) => setSelectedFileId(Number(val))}
                    >
                      {files.map((file) => {
                        const hasSp = file.hasServerPack || (file.serverPackFileId && file.serverPackFileId > 0);
                        const releaseTypeLabel =
                          file.releaseType === 1 ? 'Release' : file.releaseType === 2 ? 'Beta' : 'Alpha';
                        const sizeStr = file.fileLength > 0 ? ` (${formatFileSize(file.fileLength)})` : '';
                        const spTag = hasSp ? ' [Server Pack]' : '';

                        return (
                          <option key={file.id} value={file.id}>
                            {file.displayName || file.fileName} - {releaseTypeLabel}
                            {spTag}
                            {sizeStr}
                          </option>
                        );
                      })}
                    </Select>
                  )}

                  {selectedFile && !hasDedicatedServerPack && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-300/90">
                      Note: This release does not include a direct server distribution file. MCM will attempt to unpack and configure the primary distribution archive.
                    </p>
                  )}
                </div>

                {/* 2. Server Name */}
                <div className="space-y-2">
                  <Label htmlFor="server-name-input" className="text-xs font-semibold">
                    Server Container Name
                  </Label>
                  <Input
                    id="server-name-input"
                    value={serverName}
                    onChange={(e) => setServerName(e.target.value)}
                    placeholder="Enter instance name..."
                    disabled={deploying}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    This identifier will be displayed in the MCM fleet dashboard and Docker engine.
                  </p>
                </div>

                {/* 3. Allocated RAM */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold">Allocated RAM Memory</Label>
                    <span className="font-mono text-xs font-bold text-primary">
                      {Math.round(ramMb / 1024)} GB ({ramMb} MB)
                    </span>
                  </div>

                  {/* Preset Pills */}
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {RAM_PRESETS.map((preset) => {
                      const selected = ramMb === preset.mb;
                      return (
                        <button
                          type="button"
                          key={preset.mb}
                          onClick={() => setRamMb(preset.mb)}
                          className={`relative flex flex-col items-center justify-center rounded-lg border p-2 text-center transition-all ${
                            selected
                              ? 'border-primary bg-primary/10 text-primary font-semibold ring-1 ring-primary'
                              : 'border-border/80 bg-card hover:bg-secondary/60 text-foreground'
                          }`}
                        >
                          <span className="text-xs">{preset.label}</span>
                          {preset.recommended && (
                            <span className="mt-0.5 text-[9px] text-primary/90 font-medium">
                              Best
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Fine-grained slider */}
                  <div className="pt-2">
                    <input
                      type="range"
                      min={2048}
                      max={32768}
                      step={1024}
                      value={ramMb}
                      onChange={(e) => setRamMb(Number(e.target.value))}
                      className="h-2 w-full cursor-pointer accent-primary"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground pt-1">
                      <span>2 GB</span>
                      <span>8 GB (Recommended)</span>
                      <span>16 GB</span>
                      <span>32 GB</span>
                    </div>
                  </div>
                </div>

                {/* 4. Host Port */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="server-port-input" className="text-xs font-semibold">
                      Primary Host Game Port
                    </Label>
                    {portConflictServer && (
                      <span className="text-[11px] font-semibold text-destructive">
                        Port occupied by "{portConflictServer}"
                      </span>
                    )}
                  </div>

                  <div className="relative">
                    <Input
                      id="server-port-input"
                      type="number"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      placeholder="25565"
                      min={1}
                      max={65535}
                      className={portConflictServer ? 'border-destructive focus-visible:ring-destructive' : ''}
                      disabled={deploying}
                    />
                  </div>

                  <p className="text-[11px] text-muted-foreground">
                    Minecraft clients connect to this host port (default: 25565). MCM checks port conflicts across all containers.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        {!deployedResult && (
          <div className="flex items-center justify-between border-t px-6 py-4 bg-secondary/20">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={deploying}
              className="text-xs"
            >
              Cancel
            </Button>

            <Button
              variant="default"
              onClick={() => void handleDeploy()}
              disabled={deploying || loadingFiles || !selectedFileId || !serverName.trim() || isPortInvalid || Boolean(portConflictServer)}
              className="gap-2 text-xs font-semibold"
            >
              {deploying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deploying Container...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Deploy Container
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </DialogBackdrop>
  );
}
