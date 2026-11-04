import { describe, expect, it } from 'vitest';
import { hostCPUPercent } from '../src/lib/metrics';

describe('hostCPUPercent', () => {
  it.each([
    [397, 8, 49.625],
    [100, 8, 12.5],
    [50, 1, 50],
    [800, 8, 100],
    [900, 8, 100],
    [0, 8, 0],
    [0, 0, 0],
  ])('converts %s%% across %s host cores to %s%%', (percent, cores, expected) => {
    expect(hostCPUPercent(percent, cores)).toBe(expected);
  });

  it.each([0, -1, 1.5, NaN, Infinity, null, undefined])('does not guess a missing or invalid core count: %s', (cores) => {
    expect(hostCPUPercent(397, cores)).toBeNull();
  });

  it.each([null, undefined, NaN, Infinity, -1])('preserves unavailable or invalid usage as a gap: %s', (percent) => {
    expect(hostCPUPercent(percent, 8)).toBeNull();
  });
});
