import { Fragment } from 'react';
import { getWeaponDieForItem, type WeaponProgressionConfig } from '@/shared/formulas/combat';
import { CLASS_WEAPON_AFFINITY } from '@/lib/game-data';
import ItemIllustration from '@/components/items/ItemIllustration';
import { itemSubtitle, statLabel, affinityLabelFor, type DisplayItem } from '@/lib/item-display';

interface ItemLike extends DisplayItem {
  description?: string | null;
  level?: number | null;
  stats?: Record<string, number> | null;
  value?: number | null;
  illustration_url?: string | null;
}

const RARITY_COLORS: Record<string, string> = {
  common: 'text-foreground',
  uncommon: 'text-elvish',
  rare: 'text-rare',
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
}

const Divider = () => <div className="my-1.5 h-px bg-border/60" />;

export default function ItemTooltipCard({
  item, weaponProgression, classKey,
  durabilityPct, qty, isBroken,
  comparison, flavorText, showValue = true,
}: Props) {
  const stats = item.stats || {};
  const statEntries = Object.entries(stats).filter(([, v]) => (v as number) !== 0);
  const subtitle = itemSubtitle(item);
  const isWeapon = !!item.weapon_tag;
  const die = isWeapon
    ? getWeaponDieForItem(item.weapon_tag ?? null, item.hands === 2 ? 2 : 1, item.level ?? null, weaponProgression)
    : 0;
  const affinity = affinityLabelFor(item.weapon_tag, classKey, CLASS_WEAPON_AFFINITY);

  return (
    <div className="space-y-1.5 max-w-xs">
      {item.illustration_url && (
        <ItemIllustration url={item.illustration_url} alt={item.name} />
      )}

      {/* Identity */}
      <div className="text-center">
        <div className={`font-display text-sm tracking-wide ${rarityClass(item)}`}>{item.name}</div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{subtitle}</div>
        {item.level != null && item.level > 0 && (
          <div className="text-[10px] text-muted-foreground/80">Level {item.level}</div>
        )}
      </div>

      {isBroken && (
        <div className="text-[10px] text-destructive font-display text-center">⚒ Broken — needs repair</div>
      )}

      {/* Weapon block */}
      {isWeapon && (
        <>
          <Divider />
          <div className="space-y-0.5">
            <div className="text-[10px] text-muted-foreground tracking-wide">⚔ Weapon Damage</div>
            <div className="font-display text-sm text-primary">1d{die} <span className="text-muted-foreground text-xs">+ STR</span></div>
            {affinity && (
              <div className="text-[10px] text-elvish">⛨ Affinity: {affinity}</div>
            )}
          </div>
        </>
      )}

      {/* Attributes */}
      {statEntries.length > 0 && (
        <>
          <Divider />
          <div>
            <div className="text-[10px] text-muted-foreground tracking-wide mb-0.5">Attributes</div>
            <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
              {statEntries.map(([k, v]) => (
                <Fragment key={k}>
                  <span className={`font-display ${k === 'hp_regen' ? 'text-elvish' : 'text-foreground'}`}>{statLabel(k)}</span>
                  <span className={`font-display text-right ${k === 'hp_regen' ? 'text-elvish' : 'text-foreground'}`}>+{v as number}</span>
                </Fragment>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Comparison */}
      {comparison && comparison.diffs.length > 0 && (
        <>
          <Divider />
          <div>
            <div className="text-[9px] text-muted-foreground mb-0.5">vs {comparison.label}</div>
            <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-[10px] font-display">
              {comparison.diffs.map(({ key, diff }) => (
                <>
                  <span key={`cl-${key}`} className={diff > 0 ? 'text-elvish' : 'text-destructive'}>{statLabel(key)}</span>
                  <span key={`cv-${key}`} className={`text-right ${diff > 0 ? 'text-elvish' : 'text-destructive'}`}>
                    {diff > 0 ? '+' : ''}{diff}
                  </span>
                </>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Flavor */}
      {(flavorText || item.description) && (
        <>
          <Divider />
          {flavorText
            ? <p className="text-[11px] italic text-muted-foreground/90 leading-snug">"{flavorText}"</p>
            : <p className="text-[11px] text-muted-foreground/80 leading-snug">{item.description}</p>}
        </>
      )}

      {/* Footer */}
      {(durabilityPct != null || (showValue && item.value != null) || (qty && qty > 1)) && (
        <div className="text-[10px] text-muted-foreground/70 pt-0.5 flex justify-between gap-2">
          <span>
            {durabilityPct != null && <>Durability {durabilityPct}%</>}
            {durabilityPct != null && showValue && item.value != null ? ' · ' : ''}
            {showValue && item.value != null && <>Value {item.value}g</>}
          </span>
          {qty && qty > 1 && <span>×{qty}</span>}
        </div>
      )}
    </div>
  );
}
