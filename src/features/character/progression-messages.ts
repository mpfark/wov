const refusals: Record<string, string> = {
  commands_paused: 'Progression commands are paused.', not_at_trainer: 'Visit a trainer first.',
  renown_level_required: 'Renown training requires level 30.', dead: 'A living character is required.',
  active_combat: 'Finish combat before training.', unsafe_lifecycle: 'Finish movement and deactivate any stance before training.',
  insufficient_rp: 'Insufficient Renown points.', insufficient_respec_token: 'A respec token is required.',
  empty_refund: 'There is no proven discretionary investment to refund.', pool_cap: 'This refund would exceed the 200-point pool limit.',
  stale_state: 'Character progression changed. Refresh and try again.', location_changed: 'Location changed. Refresh and try again.',
  request_conflict: 'This request ID belongs to a different command.', inconsistent_provenance: 'Progression history requires reconciliation.',
  invalid_state: 'Character state requires reconciliation.', arithmetic_overflow: 'This progression exceeds supported storage.',
};
export function progressionRefusal(reason?: string) { return refusals[reason ?? ''] ?? `Progression refused: ${reason ?? 'unavailable'}.`; }
