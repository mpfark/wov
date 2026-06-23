# Idle-world auto-sleep

Yes — and it's a high-leverage change. Right now the creature tick, marketplace expirer, unique-item return, king-slayer expirer, and email queue all run on schedule regardless of whether anyone is logged in. When the realm is empty those jobs still burn cron slots, WAL, and CPU.

## Concept

Add a single "world is awake" check that every periodic job consults as its first line. If no character has been online in the last N minutes, return immediately without touching any tables. When a player logs in, the world "wakes" and the next cron tick resumes normal work.

## How it works

### Wake-state source
We already track `characters.last_online`. Define **awake** as:

```sql
EXISTS (SELECT 1 FROM public.characters WHERE last_online > now() - interval '5 minutes')
```

Wrap that in a tiny `STABLE` function `public.world_is_awake()` so callers are cheap and consistent. 5 minutes is the right window because `last_online` is heartbeated about that often; anything tighter risks false-sleep mid-session.

### Cron jobs gated by it
Each scheduled function gets an early-exit guard:

```sql
CREATE OR REPLACE FUNCTION public.tick_creatures() …
BEGIN
  IF NOT public.world_is_awake() THEN RETURN; END IF;
  PERFORM public.regen_creature_hp();
  PERFORM public.respawn_creatures();
END;
```

Apply the same guard to:
- `tick_creatures` (regen + respawn)
- `return_unique_items`
- `expire_marketplace_listings`
- `expire_king_slayer`
- `prune-cron-history` — **keep running** even when asleep (it's the housekeeping itself)
- `process-email-queue` — **keep running** (out-of-band notifications, e.g. password reset, must work when no one is in-game)
- `monthly-scene-drain` — **keep running** (must fire on the last day)

### Wake on login
First time a player's `last_online` updates after a sleep period, the next cron tick (≤2 min later) just runs normally. No login handler change needed. The very first creature respawn after wake-up may lag up to one cron interval; this is invisible because the player still needs to walk to a node.

### Optional fast-wake (not in scope)
We could call `tick_creatures()` directly from the login edge function to skip the 2-minute lag. Adds complexity for a single cycle of wait; recommend skipping unless players complain.

## Gameplay impact

- **Active sessions**: zero change. As long as one player is online, everything runs as before.
- **First player after a quiet period**: world state is whatever it was when the last player left, plus up to ~2 minutes of catch-up lag for creature respawns (which players won't notice — they have to travel to a node anyway).
- **Marketplace listings**: an expired listing might linger up to one cron interval past its expiry while asleep. Harmless — the next awake tick removes it before anyone could buy it.
- **Unique items held by offline characters**: same — return delay is bounded by the gap until someone logs in.

## Cost impact

When the realm is empty (likely the majority of hours in early days), the awake-guarded jobs become a single index-touch SELECT that returns instantly. Effectively we drop most cron-driven write load to zero during quiet hours.

## Open questions

1. **Awake window** — `5 minutes` matches the heartbeat. Want a tighter or looser threshold?
2. **Fast-wake on login** — should we eagerly tick on first login after sleep, or accept the small lag?
3. **What counts as "online"** — just `last_online` from `characters`, or also include `auth.users.last_sign_in_at`? `last_online` is the right answer for gameplay; `last_sign_in_at` would keep the world awake for someone idling on the login screen.

Default if you don't answer: 5 min window, no fast-wake, `characters.last_online` only.
