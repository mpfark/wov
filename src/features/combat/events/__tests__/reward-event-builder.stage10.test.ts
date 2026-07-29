import { describe, expect, it } from 'vitest';
import { buildRewardLogEvent } from '../reward-event-builder';
import { presentationForEvent } from '../presentation';

const ME = 'char-1';

describe('Stage 10 — loot, rewards, progression, quests', () => {
  it('returns null for events owned by other stages', () => {
    expect(buildRewardLogEvent({ type: 'attack_hit', message: 'x' }, ME, 'Aldric')).toBeNull();
  });

  it('classifies a gem drop as loot and strips the decorative glyph', () => {
    const ev = buildRewardLogEvent(
      { type: 'gem_drop', message: '💎 Found a Ruby of Might!', character_id: ME },
      ME,
      'Aldric',
    )!;
    expect(ev.type).toBe('loot');
    expect(ev.message).toBe('Found a Ruby of Might!');
    expect(ev.effectType).toBe('gem');
    expect(presentationForEvent(ev).family).toBe('notable');
  });

  it('carries a structured amount for XP rewards', () => {
    const ev = buildRewardLogEvent(
      { type: 'xp_reward', message: 'You gain experience.', xp: 120, character_id: ME },
      ME,
      'Aldric',
    )!;
    expect(ev.type).toBe('reward');
    expect(ev.amount).toBe(120);
    expect(ev.amountKind).toBe('xp');
  });

  it('folds the local name to second person on level ups', () => {
    const ev = buildRewardLogEvent(
      { type: 'level_up', message: '🎉 Level Up! Aldric is now level 12!', character_id: ME },
      ME,
      'Aldric',
    )!;
    expect(ev.type).toBe('level_up');
    expect(ev.message).toContain('Level Up!');
    expect(ev.remoteMessage).toContain('Aldric');
    expect(presentationForEvent(ev).marker).toBe('level_up');
  });

  it('keeps stat points and class bonuses routine so they carry no marker', () => {
    const ev = buildRewardLogEvent(
      { type: 'stat_point', message: '📊 Aldric gained 1 stat point to allocate!', character_id: ME },
      ME,
      'Aldric',
    )!;
    expect(ev.severity).toBe('routine');
    expect(presentationForEvent(ev).marker).toBeNull();
  });

  it('routes contract completion to the quest family', () => {
    const ev = buildRewardLogEvent(
      { type: 'contract_complete', message: '🗡️ Contract fulfilled — Ser Caldris put down.', character_id: ME },
      ME,
      'Aldric',
    )!;
    expect(ev.type).toBe('quest');
    expect(ev.message.startsWith('Contract fulfilled')).toBe(true);
    expect(presentationForEvent(ev).marker).toBe('quest');
  });

  it('uses the observer prose for another player\'s reward', () => {
    const ev = buildRewardLogEvent(
      { type: 'level_up', message: '🎉 Level Up! Brynn is now level 9!', character_id: 'char-2' },
      ME,
      'Aldric',
    )!;
    expect(ev.message).toContain('Brynn');
    expect(ev.source?.kind).toBe('player');
  });
});
