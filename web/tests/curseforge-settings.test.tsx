import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithAdmin, renderWithUser, adminUser } from '../src/test/auth';
import * as curseforge from '../src/api/curseforge';
import { CurseForgeSettings } from '../src/components/curseforge-settings';

afterEach(() => vi.restoreAllMocks());

describe('shared CurseForge settings', () => {
  it('saves a write-only shared key and clears the input', async () => {
    const user = userEvent.setup();
    const status = vi.spyOn(curseforge, 'getCurseForgeSettings').mockResolvedValue({ configured: false, source: '' });
    const save = vi.spyOn(curseforge, 'saveCurseForgeApiKey').mockImplementation(async () => {
      status.mockResolvedValue({ configured: true, source: 'database' });
      return { configured: true, source: 'database' };
    });
    renderWithAdmin(<CurseForgeSettings />);
    await screen.findByText('No shared API key is configured.');
    const input = screen.getByLabelText('API key');
    await user.type(input, 'shared-secret');
    await user.click(screen.getByRole('button', { name: 'Save shared key' }));
    await screen.findByText('Shared CurseForge settings saved.');
    expect(save).toHaveBeenCalledWith('shared-secret');
    expect(input).toHaveValue('');
    expect(screen.getByLabelText('Replace API key')).toHaveAttribute('type', 'password');
    expect(screen.getByText(/Connected using the shared saved key/)).toBeInTheDocument();
    expect(localStorage.getItem('mcm_curseforge_api_key')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Remove saved key' }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(''));
  });

  it('shows shared availability without key controls to non-managers', async () => {
    vi.spyOn(curseforge, 'getCurseForgeSettings').mockResolvedValue({ configured: true, source: 'environment' });
    renderWithUser(<CurseForgeSettings />, { ...adminUser, role: 'viewer', permissions: ['servers.view'] });
    await screen.findByText(/Connected using CURSEFORGE_API_KEY on the panel/);
    expect(screen.queryByLabelText(/API key/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save shared key' })).not.toBeInTheDocument();
    expect(screen.getByText(/Ask an administrator/)).toBeInTheDocument();
  });

  it('keeps a failed save visible and does not report success', async () => {
    const user = userEvent.setup();
    vi.spyOn(curseforge, 'getCurseForgeSettings').mockResolvedValue({ configured: false, source: '' });
    vi.spyOn(curseforge, 'saveCurseForgeApiKey').mockRejectedValue(new Error('Save failed'));
    renderWithAdmin(<CurseForgeSettings />);
    await screen.findByText('No shared API key is configured.');
    await user.type(screen.getByLabelText('API key'), 'new-key');
    await user.click(screen.getByRole('button', { name: 'Save shared key' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
    expect(screen.getByLabelText('API key')).toHaveValue('new-key');
    expect(screen.queryByText('Shared CurseForge settings saved.')).not.toBeInTheDocument();
  });
});
