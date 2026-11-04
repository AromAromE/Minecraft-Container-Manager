import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client';
import type { ServerStats } from '../src/api/types';
import { ServerStatsGrid } from '../src/components/server-stats-grid';

const mockOnlineStats: ServerStats = {
  server_id: 'srv-1',
  online: true,
  cpu_percent: 98, // Docker-style usage: 24.5% of a four-core host.
  cpu_cores: 4,
  cpu_limit: 2,
  memory_bytes: 2147483648, // 2 GB
  memory_limit_bytes: 4294967296, // 4 GB
  memory_percent: 50.0,
  disk_bytes: 838860800, // 800 MB
  disk_read_bytes: 10485760, // 10 MB
  disk_write_bytes: 20971520, // 20 MB
  net_rx_bytes: 5242880, // 5 MB
  net_tx_bytes: 15728640, // 15 MB
};

const mockStoppedStats: ServerStats = {
  server_id: 'srv-1',
  online: false,
  cpu_percent: 0,
  cpu_cores: 4,
  cpu_limit: 2,
  memory_bytes: 0,
  memory_limit_bytes: 4294967296,
  memory_percent: 0,
  disk_bytes: 838860800, // 800 MB (world size on disk)
  disk_read_bytes: 0,
  disk_write_bytes: 0,
  net_rx_bytes: 0,
  net_tx_bytes: 0,
};

describe('ServerStatsGrid Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all 4 stat cards (CPU, MEM, Disk, Network)', async () => {
    vi.spyOn(api, 'serverStats').mockResolvedValue(mockOnlineStats);

    render(<ServerStatsGrid serverId="srv-1" isRunning={true} />);

    await waitFor(() => {
      expect(screen.getByTestId('stat-cpu')).toBeInTheDocument();
      expect(screen.getByTestId('stat-mem')).toBeInTheDocument();
      expect(screen.getByTestId('stat-disk')).toBeInTheDocument();
      expect(screen.getByTestId('stat-network')).toBeInTheDocument();
    });
  });

  it('displays accurate online stats for CPU, Memory, Disk, and Network with Live badges', async () => {
    vi.spyOn(api, 'serverStats').mockResolvedValue(mockOnlineStats);

    render(<ServerStatsGrid serverId="srv-1" isRunning={true} />);

    await waitFor(() => {
      expect(screen.getByTestId('stat-cpu-value')).toHaveTextContent('24.5%');
      expect(screen.getByTestId('stat-mem-value')).toHaveTextContent('2 GB');
      expect(screen.getByText(/\/ 4 GB/)).toBeInTheDocument();
      expect(screen.getByTestId('stat-disk-value')).toHaveTextContent('800 MB');
      expect(screen.getByTestId('stat-network-rx')).toHaveTextContent('5 MB');
      expect(screen.getByTestId('stat-network-tx')).toHaveTextContent('15 MB');
    });

    // Check Live indicators
    const liveIndicators = screen.getAllByText(/Live/i);
    expect(liveIndicators.length).toBeGreaterThan(0);
  });

  it('displays stopped/offline state with zero CPU/MEM while preserving disk usage', async () => {
    vi.spyOn(api, 'serverStats').mockResolvedValue(mockStoppedStats);

    render(<ServerStatsGrid serverId="srv-1" isRunning={false} />);

    await waitFor(() => {
      expect(screen.getByTestId('stat-cpu-value')).toHaveTextContent('0.0%');
      expect(screen.getByTestId('stat-mem-value')).toHaveTextContent('0 B');
      expect(screen.getByTestId('stat-disk-value')).toHaveTextContent('800 MB');
      expect(screen.getByTestId('stat-network-rx')).toHaveTextContent('0 B');
      expect(screen.getByTestId('stat-network-tx')).toHaveTextContent('0 B');
    });

    // Verify Offline label is shown
    expect(screen.getAllByText(/Offline/i).length).toBeGreaterThan(0);
  });

  it('shows 397% container usage as 49.6% of an eight-core host, not the CPU quota', async () => {
    vi.spyOn(api, 'serverStats').mockResolvedValue({ ...mockOnlineStats, cpu_percent: 397, cpu_cores: 8, cpu_limit: 4 });
    render(<ServerStatsGrid serverId="srv-1" isRunning />);

    await waitFor(() => expect(screen.getByTestId('stat-cpu-value')).toHaveTextContent('49.6%'));
    const meter = screen.getByRole('meter', { name: 'CPU usage' });
    expect(meter).toHaveAttribute('aria-valuenow', '49.6');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(meter.firstElementChild).toHaveStyle({ width: '49.625%' });
    expect(meter.firstElementChild).not.toHaveClass('bg-destructive');
    expect(screen.getByText('Of host CPU · 8 cores')).toBeInTheDocument();
    expect(screen.getByText('Limit: 4 cores')).toBeInTheDocument();
  });

  it('keeps unlimited multi-core CPU usage within the whole-host meter range', async () => {
    vi.spyOn(api, 'serverStats').mockResolvedValue({ ...mockOnlineStats, cpu_percent: 900, cpu_cores: 8, cpu_limit: 0 });
    render(<ServerStatsGrid serverId="srv-1" isRunning />);

    await waitFor(() => expect(screen.getByTestId('stat-cpu-value')).toHaveTextContent('100.0%'));
    expect(screen.getByRole('meter', { name: 'CPU usage' })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.queryByText(/Limit:/)).not.toBeInTheDocument();
  });

  it('marks CPU unavailable instead of displaying per-core usage when host capacity is unknown', async () => {
    vi.spyOn(api, 'serverStats').mockResolvedValue({ ...mockOnlineStats, cpu_cores: 0 });
    render(<ServerStatsGrid serverId="srv-1" isRunning />);

    await waitFor(() => expect(screen.getByTestId('stat-cpu-value')).toHaveTextContent('—'));
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('meter', { name: 'CPU usage' })).not.toBeInTheDocument();
    expect(screen.getByTestId('stat-mem-value')).toHaveTextContent('2 GB');
  });

  it('zeros CPU when stopped even if the last API reading was online', async () => {
    vi.spyOn(api, 'serverStats').mockResolvedValue(mockOnlineStats);
    render(<ServerStatsGrid serverId="srv-1" isRunning={false} />);

    await waitFor(() => expect(api.serverStats).toHaveBeenCalled());
    expect(screen.getByTestId('stat-cpu-value')).toHaveTextContent('0.0%');
    expect(screen.getByRole('meter', { name: 'CPU usage' })).toHaveAttribute('aria-valuenow', '0');
  });

  it('handles API failure gracefully without crashing', async () => {
    vi.spyOn(api, 'serverStats').mockRejectedValue(new Error('Network error'));

    render(<ServerStatsGrid serverId="srv-1" isRunning={true} />);

    await waitFor(() => {
      expect(screen.getByTestId('server-stats-grid')).toBeInTheDocument();
      expect(screen.getByTestId('stat-cpu')).toBeInTheDocument();
    });
  });
});
