import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from '../src/api/client';
import { PanelBuildNotice } from '../src/components/panel-build-notice';
import * as panelBuild from '../src/lib/panel-build';

const newerCommit = 'abcdef1234567890abcdef1234567890abcdef12';

describe('Browser panel build tracking', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    panelBuild.observePanelBuild(panelBuild.browserBuildCommit);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('persists the loaded bundle commit without changing unrelated preferences', () => {
    window.localStorage.setItem('mcm-theme', 'dark');
    panelBuild.rememberBrowserBuild();
    expect(window.localStorage.getItem(panelBuild.browserBuildStorageKey)).toBe(panelBuild.browserBuildCommit);
    panelBuild.observePanelBuild(newerCommit);
    expect(window.localStorage.getItem(panelBuild.browserBuildStorageKey)).toBe(panelBuild.browserBuildCommit);
    expect(window.localStorage.getItem('mcm-theme')).toBe('dark');
  });

  it('still detects outdated pages when storage is disabled or changed by another tab', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    expect(() => panelBuild.rememberBrowserBuild()).not.toThrow();
    expect(panelBuild.browserBuildNeedsRefresh(newerCommit)).toBe(true);
    vi.restoreAllMocks();
    window.localStorage.setItem(panelBuild.browserBuildStorageKey, newerCommit);
    expect(panelBuild.browserBuildNeedsRefresh(newerCommit)).toBe(true);
  });

  it('does not request refreshes for matching or unavailable build metadata', () => {
    expect(panelBuild.browserBuildNeedsRefresh(panelBuild.browserBuildCommit)).toBe(false);
    expect(panelBuild.browserBuildNeedsRefresh('unknown')).toBe(false);
    expect(panelBuild.browserBuildNeedsRefresh(null)).toBe(false);
  });

  it('creates a cache-busting document URL while preserving the current page, tab and fragment', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    const url = new URL(panelBuild.panelRefreshURL(newerCommit, 'https://mcm.test/settings?tab=updates&_mcm_reload=old#log'));
    expect(url.origin).toBe('https://mcm.test');
    expect(url.pathname).toBe('/settings');
    expect(url.searchParams.get('tab')).toBe('updates');
    expect(url.searchParams.get('_mcm_build')).toBe(newerCommit);
    expect(url.searchParams.getAll('_mcm_reload')).toEqual(['1234']);
    expect(url.hash).toBe('#log');
    vi.spyOn(Date, 'now').mockReturnValue(5678);
    expect(panelBuild.panelRefreshURL(newerCommit, url.href)).not.toBe(url.href);
  });

  it('notifies subscribers only when a known server build changes', () => {
    const listener = vi.fn();
    const unsubscribe = panelBuild.subscribePanelBuild(listener);
    panelBuild.observePanelBuild(null);
    panelBuild.observePanelBuild('unknown');
    panelBuild.observePanelBuild(panelBuild.browserBuildCommit);
    expect(listener).not.toHaveBeenCalled();
    panelBuild.observePanelBuild(newerCommit);
    panelBuild.observePanelBuild(newerCommit);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    panelBuild.observePanelBuild(panelBuild.browserBuildCommit);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('offers a full refresh from ordinary API responses, including updates made outside this tab', async () => {
    const refresh = vi.spyOn(panelBuild, 'fullRefreshPanel').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true }, { headers: { 'X-MCM-Build-Commit': newerCommit } })));
    render(<PanelBuildNotice />);
    expect(screen.queryByRole('button', { name: 'Full refresh' })).not.toBeInTheDocument();
    await act(async () => { await request('/api/auth/me'); });
    fireEvent.click(screen.getByRole('button', { name: 'Full refresh' }));
    expect(refresh).toHaveBeenCalledWith(newerCommit);
    act(() => { panelBuild.observePanelBuild(panelBuild.browserBuildCommit); });
    expect(screen.queryByRole('button', { name: 'Full refresh' })).not.toBeInTheDocument();
  });
});
