# Realtime Reconnect Resilience for Party Updates

## Goal
Ensure `party_members` realtime updates keep flowing after transient network drops (Wi-Fi blips, tab sleep, server-side socket resets). Today both `party-${characterId}` and `party-roster-${party.id}` channels call `.subscribe()` with no status handler, so a `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` event silently kills the stream until the component remounts. The 60s safety-net poll masks but does not fix it.

## Scope
Only `src/features/party/hooks/useParty.ts`. No DB, no broadcast changes. (`usePartyBroadcast` is a separate concern — broadcast channels are short-lived per-combat and out of scope.)

## Changes

### 1. Status-aware subscribe with auto-rejoin
Wrap the existing two `.subscribe()` calls with a status callback:

```ts
.subscribe((status, err) => {
  if (status === 'SUBSCRIBED') {
    // Reconnect path: pull fresh state to cover events missed while disconnected
    fetchParty();           // for invite channel
    fetchMemberStatsCore(); // for roster channel
  } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
    // Tear down + rejoin after backoff; supabase-js does not auto-resubscribe
    scheduleReconnect();
  }
});
```

`scheduleReconnect` uses exponential backoff (1s → 2s → 5s → 10s, cap 30s) with a per-channel timer ref, cleared on successful `SUBSCRIBED`.

### 2. Window-level reconnect triggers
Add a single effect that listens to `window` `online` and `document` `visibilitychange→visible` and forces both channels to tear down and rejoin (cheap, ensures we recover quickly when the user returns or Wi-Fi comes back). Replaces the existing visibility-only refetch.

### 3. Keep the 60s safety net
Leave the existing `setInterval(fetchMemberStatsCore, 60_000)` as the final backstop in case all of the above fails.

## Files
- `src/features/party/hooks/useParty.ts` — add status handlers, reconnect scheduler, online listener; refetch on every successful (re)subscribe.

## Out of Scope
- `usePartyBroadcast` channels
- Other realtime subscriptions (chat, marketplace, node) — can follow the same pattern in a later pass if needed
- No new dependencies, no migration

## Verification
1. Join a party with two clients.
2. In one client, toggle offline in DevTools for ~10s, then back online. Within ~2s the roster should re-sync (visible via a Follow toggle on the other client).
3. Background the tab for 1 minute, switch back — roster should be current immediately, no 60s wait.
4. Network log should show one new realtime websocket connection per drop, not a tight reconnect loop.
