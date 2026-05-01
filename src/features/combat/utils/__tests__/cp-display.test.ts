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

  describe('PoE-style stance reservation (right-pinned tail)', () => {
    it('pins reserved tail width regardless of usable level', () => {
      // 200 max, 30 reserved by stance, 80 usable left
      const d = getCpDisplay(80, 200, 0, 30);
      expect(d.stancePercent).toBe(15);
      expect(d.usableMaxCp).toBe(170);
      expect(d.usableMaxPercent).toBe(85);
      expect(d.displayedCp).toBe(50);
      expect(d.cpPercent).toBe(25);
      expect(d.availableCp).toBe(50);
      expect(d.stanceShown).toBe(30);
    });

    it('queued + stance never overlap and both subtract from available', () => {
      // 200 max, 30 reserved, 20 queued, raw 100 -> usable 50
      const d = getCpDisplay(100, 200, 20, 30);
      expect(d.queuedShown).toBe(20);
      expect(d.stanceShown).toBe(30);
      expect(d.displayedCp).toBe(50);
      expect(d.availableCp).toBe(50);
      // stance pinned right (15%), queued (10%) sits left of it
      expect(d.cpPercent + d.queuedPercent + d.stancePercent).toBeLessThanOrEqual(100);
    });

    it('full reservation collapses fill to zero', () => {
      const d = getCpDisplay(100, 100, 0, 100);
      expect(d.stancePercent).toBe(100);
      expect(d.usableMaxCp).toBe(0);
      expect(d.displayedCp).toBe(0);
      expect(d.cpPercent).toBe(0);
    });
  });
});
