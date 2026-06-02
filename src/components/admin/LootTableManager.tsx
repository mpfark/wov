import { useState } from 'react';
import { Package, Settings, Boxes, ListChecks, PawPrint } from 'lucide-react';
import AdminPageShell from './common/AdminPageShell';
import PoolRulesTab from './loot/PoolRulesTab';
import ItemPoolTab from './loot/ItemPoolTab';
import LegacyLootTablesTab from './loot/LegacyLootTablesTab';
import CreatureLootModesTab from './loot/CreatureLootModesTab';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { key: 'rules', label: 'Pool Rules', icon: Settings },
  { key: 'items', label: 'Item Pool', icon: Boxes },
  { key: 'legacy', label: 'Legacy Tables', icon: ListChecks },
  { key: 'creatures', label: 'Creature Modes', icon: PawPrint },
] as const;

export default function LootTableManager() {
  const [active, setActive] = useState<string>('rules');

  const renderSection = () => {
    switch (active) {
      case 'rules':
        return <div className="h-full overflow-auto"><PoolRulesTab /></div>;
      case 'items':
        return <div className="h-full overflow-hidden"><ItemPoolTab /></div>;
      case 'legacy':
        return <div className="h-full overflow-hidden"><LegacyLootTablesTab /></div>;
      case 'creatures':
        return <div className="h-full overflow-hidden"><CreatureLootModesTab /></div>;
      default:
        return null;
    }
  };

  return (
    <AdminPageShell
      icon={<Package className="w-4 h-4" />}
      title="Loot Tables"
      tools={
        <nav className="p-2 space-y-1">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const isActive = active === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setActive(s.key)}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-muted/50 text-foreground',
                )}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{s.label}</span>
              </button>
            );
          })}
        </nav>
      }
    >
      {renderSection()}
    </AdminPageShell>
  );
}
