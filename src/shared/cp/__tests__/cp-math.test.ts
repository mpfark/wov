import { describe, it, expect } from 'vitest';
import { sumReservedCp, getAvailableCp, type ReservedBuffsMap } from '../cp-math';

describe('sumReservedCp', () => {
  it('returns 0 for null/undefined', () => {
    expect(sumReservedCp(null)).toBe(0);
    expect(sumReservedCp(undefined)).toBe(0);
    expect(sumReservedCp({})).toBe(0);
  });

  it('tolerates entries missing the reserved field', () => {
    const map: ReservedBuffsMap = {
      ignite: { tier: 3 },
      eagle_eye: { tier: 1, reserved: 5 },
    };
    expect(sumReservedCp(map)).toBe(5);
  });

  it('clamps negative reserved values to 0', () => {
    const map: ReservedBuffsMap = {
      a: { reserved: -10 },
      b: { reserved: 7 },
    };
    expect(sumReservedCp(map)).toBe(7);
  });

  it('sums multiple stances', () => {
    const map: ReservedBuffsMap = {
      eagle_eye: { reserved: 5 },
      arcane_surge: { reserved: 8 },
      ignite: { reserved: 12 },
    };
    expect(sumReservedCp(map)).toBe(25);
  });
});

describe('getAvailableCp', () => {
  it('subtracts reserved from raw', () => {
    expect(getAvailableCp(40, 10)).toBe(30);
  });

  it('clamps to 0 when reserved exceeds raw', () => {
    expect(getAvailableCp(5, 50)).toBe(0);
  });

  it('subtracts queued in addition to reserved', () => {
    expect(getAvailableCp(40, 10, 5)).toBe(25);
  });

  it('blocks ability when CP is reserved by stances', () => {
    const rawCp = 50;
    const reserved = 40;
    const cost = 15;
    const available = getAvailableCp(rawCp, reserved);
    expect(available).toBe(10);
    expect(available < cost).toBe(true);
  });
});
