import { Fragment } from 'react';
import { getWeaponDieForItem, type WeaponProgressionConfig } from '@/shared/formulas/combat';
import { isShield } from '@/shared/formulas/classes';
import { CLASS_WEAPON_AFFINITY } from '@/lib/game-data';
import ItemIllustration from '@/components/items/ItemIllustration';
import { itemSubtitle, statLabel, affinityLabelFor, type DisplayItem } from '@/lib/item-display';
import { effectiveItemStats } from '@/shared/formulas/items';
import { GEM_CATALOG, type GemKey } from '@/shared/formulas/gems';

interface ItemLike extends DisplayItem {
  description?: string | null;
  level?: number | null;
  stats?: Record<string, number> | null;
  value?: number | null;
  illustration_url?: string | null;
  procs?: any;
}


// Subtle, non-revealing flavor lines for items with chance-on-hit procs.
const PROC_FLAVOR_LINES = [
  'Something about this weapon feels… unsettlingly alive.',
  'A faint hum resonates from within, as if waiting for blood.',
  'Its edge seems to hunger for more than mere flesh.',
  'You catch a whisper on the wind each time it strikes true.',
  'The metal warms in your grip when combat stirs.',
];

function hasProcs(procs: any): boolean {
  if (!procs) return false;
  if (Array.isArray(procs)) return procs.length > 0;
  if (typeof procs === 'object') return Object.keys(procs).length > 0;
  return false;
}

function procFlavorFor(item: { id?: string | number | null; name?: string | null }): string {
  const seed = String(item.id ?? item.name ?? '');
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return PROC_FLAVOR_LINES[Math.abs(h) % PROC_FLAVOR_LINES.length];
}


const RARITY_COLORS: Record<string, string> = {
  common: 'text-foreground',
  uncommon: 'text-elvish',
  rare: 'text-blue-400',
  unique: 'text-primary text-glow',
  soulforged: 'text-soulforged text-glow-soulforged',
};

function rarityClass(item: { rarity: string; is_soulbound?: boolean }): string {
  if (item.is_soulbound) return RARITY_COLORS.soulforged;
  return RARITY_COLORS[item.rarity] || RARITY_COLORS.common;
}

interface ComparisonProp {
  label: string;
  diffs: { key: string; diff: number }[];
}

interface Props {
  item: ItemLike;
  weaponProgression?: WeaponProgressionConfig;
  classKey?: string;
  durabilityPct?: number;
  qty?: number;
  isBroken?: boolean;
  comparison?: ComparisonProp | null;
  flavorText?: string | null;
  showValue?: boolean;
  /** Per-instance gem upgrades (gem key → count). Adds +1 to mapped stat per gem. */
  appliedGems?: Record<string, number> | null;
  /** Per-instance base stat override (replaces items.stats for display). */
  statOverride?: Record<string, number> | null;
}


const Divider = () => <div className="divider-hairline" />;

export default function ItemTooltipCard({
  item, weaponProgression, classKey,
  durabilityPct, qty, isBroken,
  comparison, flavorText, showValue = true,
  appliedGems, statOverride,
}: Props) {
  const stats = effectiveItemStats({
    baseStats: item.stats,
    statOverride,
    appliedGems,
  });
  const statEntries = Object.entries(stats).filter(([, v]) => (v as number) !== 0);
  const gemEntries = Object.entries(appliedGems ?? {}).filter(([, v]) => (v as number) > 0);
  const subtitle = itemSubtitle(item);
  const isWeapon = !!item.weapon_tag && !isShield(item.weapon_tag);
  const die = isWeapon
    ? getWeaponDieForItem(item.weapon_tag ?? null, item.hands === 2 ? 2 : 1, item.level ?? null, weaponProgression, (item as any).rarity ?? null)
    : 0;
  const affinity = affinityLabelFor(item.weapon_tag, classKey, CLASS_WEAPON_AFFINITY);

  const hasStatsBlock = isWeapon || statEntries.length > 0 || (comparison && comparison.diffs.length > 0);
  const hasMetaBlock = durabilityPct != null || (showValue && item.value != null) || (qty && qty > 1) || isBroken;
  const effectiveFlavor = flavorText ?? (hasProcs(item.procs) ? procFlavorFor(item) : null);
  const hasGemBlock = gemEntries.length > 0;
  const hasFlavorBlock = !!(effectiveFlavor || item.description);



  return (
    <div className="tooltip-scroll gap-group max-w-xs">

      {item.illustration_url && (
        <ItemIllustration url={item.illustration_url} alt={item.name} />
      )}

      {/* 1 — Identity */}
      <div className="text-center gap-row">
        <div className={`t-display-sm ${rarityClass(item)}`}>{item.name}</div>
        {subtitle && <div className="t-label">{subtitle}</div>}
        {item.level != null && item.level > 0 && (
          <div className="t-meta">Level {item.level}</div>
        )}
      </div>

      {/* 2 — Stats (weapon damage + attributes + comparison) */}
      {hasStatsBlock && (
        <>
          <Divider />
          <div className="gap-group">
            {isWeapon && (
              <div className="grid grid-cols-[1fr_auto] gap-x-3 items-baseline">
                <span className="t-label">⚔ Weapon Damage</span>
                <span className="t-numeric text-sm text-primary">
                  1d{die}<span className="t-meta ml-1">+ STR</span>
                </span>
                {affinity && (
                  <>
                    <span className="t-label">⛨ Affinity</span>
                    <span className="t-body text-elvish text-right">{affinity}</span>
                  </>
                )}
              </div>
            )}

            {statEntries.length > 0 && (
              <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
                {statEntries.map(([k, v]) => {
                  const tone = k === 'hp_regen' ? 'text-elvish' : '';
                  return (
                    <Fragment key={k}>
                      <span className={`t-label ${tone}`}>{statLabel(k)}</span>
                      <span className={`t-numeric t-numeric-pos text-right text-xs ${tone}`}>+{v as number}</span>
                    </Fragment>
                  );
                })}
              </div>
            )}

            {comparison && comparison.diffs.length > 0 && (
              <div>
                <div className="t-label mb-0.5">vs {comparison.label}</div>
                <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
                  {comparison.diffs.map(({ key, diff }) => {
                    const cls = diff > 0 ? 't-numeric-pos' : 't-numeric-neg';
                    return (
                      <Fragment key={key}>
                        <span className={`t-label ${cls}`}>{statLabel(key)}</span>
                        <span className={`t-numeric ${cls} text-right text-xs`}>
                          {diff > 0 ? '+' : ''}{diff}
                        </span>
                      </Fragment>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* 3 — Metadata (durability / value / qty / broken) */}
      {hasMetaBlock && (
        <>
          <Divider />
          <div className="flex justify-between gap-2 t-meta">
            <span className="flex flex-wrap items-baseline gap-x-2">
              {isBroken && <span className="t-numeric-neg font-display">⚒ Broken</span>}
              {durabilityPct != null && (
                <span>
                  Durability <span className="t-numeric text-xs">{durabilityPct}</span>
                  <span className="t-numeric-cap">%</span>
                </span>
              )}
              {showValue && item.value != null && (
                <span>
                  Value <span className="t-numeric text-xs">{item.value}</span>
                  <span className="t-numeric-cap">g</span>
                </span>
              )}
            </span>
            {qty && qty > 1 && (
              <span><span className="t-numeric-cap">×</span><span className="t-numeric text-xs">{qty}</span></span>
            )}
          </div>
        </>
      )}

      {/* 4 — Flavor */}
      {hasFlavorBlock && (
        <>
          <Divider />
          {effectiveFlavor && (
            <p className="t-meta italic">"{effectiveFlavor}"</p>
          )}
          {item.description && (
            <p className="t-meta">{item.description}</p>
          )}
        </>
      )}
    </div>
  );
}
