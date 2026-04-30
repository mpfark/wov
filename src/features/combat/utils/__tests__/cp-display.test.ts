import { describe, it, expect } from 'vitest';
import { getCpDisplay, getAvailableCp } from '../cp-display';

describe('cp-display', () => {
  it('shows full bar with no reservation', () => {
    const d = getCpDisplay(100, 100, 0);
    expect(d.displayedCp).toBe(100);
    expect(d.cpPercent).toBe(100);
    expect(d.reservedPercent).toBe(0);
    expect(d.availableCp).toBe(100);
  });

  it('subtracts reservation from displayed CP', () => {
    const d = getCpDisplay(100, 100, 10);
    expect(d.displayedCp).toBe(90);
    expect(d.reservedShown).toBe(10);
    expect(d.cpPercent).toBe(90);
    expect(d.reservedPercent).toBe(10);
    expect(d.availableCp).toBe(90);
  });

  it('clamps reservation to raw so the bar never goes negative', () => {
    const d = getCpDisplay(5, 100, 50);
    expect(d.displayedCp).toBe(0);
    expect(d.reservedShown).toBe(5);
    expect(d.cpPercent).toBe(0);
  });

  it('handles missing reservation gracefully', () => {
    expect(getAvailableCp(40, 0)).toBe(40);
    expect(getAvailableCp(40, 10)).toBe(30);
    expect(getAvailableCp(5, 50)).toBe(0);
  });
});
