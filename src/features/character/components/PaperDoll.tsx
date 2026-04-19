import { useMemo } from 'react';
import { DOLL_CANVAS, SLOT_CONTRACT, type DollSlot } from '../utils/doll-contract';
import { resolveAppearance, resolveBaseBody, getDollSlotForItemSlot, type AppearanceEntry } from '../utils/appearance-resolver';
import { useAppearanceEntries } from '../hooks/useAppearanceEntries';

interface EquippedShape {
  equipped_slot: string | null;
  item: {
    slot: string | null;
    rarity: string;
    weapon_tag?: string | null;
    appearance_key?: string | null;
  };
}

interface PaperDollProps {
  gender: 'male' | 'female';
  equipped: EquippedShape[];
  /** Render at a smaller size (for admin compact view). Defaults to canvas size. */
  scale?: number;
  className?: string;
}

interface ResolvedLayer {
  dollSlot: DollSlot;
  entry: AppearanceEntry;
}

export default function PaperDoll({ gender, equipped, scale = 1, className = '' }: PaperDollProps) {
  const { entries } = useAppearanceEntries();

  const layers = useMemo<ResolvedLayer[]>(() => {
    const out: ResolvedLayer[] = [];

    // Base body
    const body = resolveBaseBody(gender, entries);
    if (body) out.push({ dollSlot: 'base_body', entry: body });

    // Equipment layers
    for (const inv of equipped) {
      const dollSlot = getDollSlotForItemSlot(inv.equipped_slot);
      if (!dollSlot) continue;
      const entry = resolveAppearance(
        {
          slot: inv.item.slot,
          rarity: inv.item.rarity,
          weapon_tag: inv.item.weapon_tag,
          appearance_key: inv.item.appearance_key,
        },
        entries,
      );
      if (entry) out.push({ dollSlot, entry });
    }

    // Apply occlusion: a layer's occludes[] hides others
    const occludedTags = new Set<string>();
    for (const l of out) {
      for (const tag of l.entry.occludes ?? []) {
        // Strip optional marker; in Phase 1 we treat optionals as actual occluders
        occludedTags.add(tag.replace(/\?$/, ''));
      }
    }

    // Filter: drop layers whose dollSlot appears in occludedTags
    const filtered = out.filter((l) => !occludedTags.has(l.dollSlot));

    // Sort by z (entry layer_order overrides contract z)
    filtered.sort((a, b) => {
      const za = a.entry.layer_order ?? SLOT_CONTRACT[a.dollSlot].z;
      const zb = b.entry.layer_order ?? SLOT_CONTRACT[b.dollSlot].z;
      return za - zb;
    });

    return filtered;
  }, [gender, equipped, entries]);

  const w = DOLL_CANVAS.width * scale;
  const h = DOLL_CANVAS.height * scale;

  return (
    <div
      className={`relative mx-auto rounded-md border border-border/50 bg-gradient-to-b from-muted/20 to-background/40 overflow-hidden ${className}`}
      style={{ width: w, height: h }}
      aria-label="Character paper doll"
    >
      {layers.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground/60 italic px-2 text-center">
          Paper doll appearance library is empty
        </div>
      )}
      {layers.map((l, idx) => (
        <img
          key={`${l.dollSlot}-${l.entry.id}-${idx}`}
          src={l.entry.asset_url}
          alt=""
          loading="lazy"
          className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
          style={{
            zIndex: l.entry.layer_order ?? SLOT_CONTRACT[l.dollSlot].z,
          }}
          onError={(e) => {
            // Hide broken images so the doll doesn't show alt text boxes
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ))}
    </div>
  );
}
