In `src/components/items/ItemTooltipCard.tsx`:

1. Add import: `import { isShield } from '@/shared/formulas/classes';`
2. Change `const isWeapon = !!item.weapon_tag;` to `const isWeapon = !!item.weapon_tag && !isShield(item.weapon_tag);`

Result: shields skip the "⚔ Weapon Damage" block and render only identity → attributes (AC/CON/STR) → footer.