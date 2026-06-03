import { useState } from 'react';
import { Wrench, BarChart3, Hammer, Crown, Sparkles, Shield } from 'lucide-react';
import AdminPageShell from './common/AdminPageShell';
import ItemCoverageAnalyzer from './ItemCoverageAnalyzer';
import UniqueReclaimManager from './UniqueReclaimManager';
import CreditDrainHistory from './CreditDrainHistory';
import ArchetypeMaintenancePanel from './tools/ArchetypeMaintenancePanel';
import ClassBondsInspector from './tools/ClassBondsInspector';
import { cn } from '@/lib/utils';

interface ToolsPanelProps {
  onDataChanged?: () => void;
  defaultTool?: string;
}

const TOOLS = [
  { key: 'item-coverage', label: 'Item Coverage', icon: BarChart3 },
  { key: 'archetype-maintenance', label: 'Archetype Maintenance', icon: Hammer },
  { key: 'class-bonds', label: 'Class Bonds', icon: Shield },
  { key: 'unique-reclaim', label: 'Unique Reclaim', icon: Crown },
  { key: 'credit-drain', label: 'Credit Drain', icon: Sparkles },
] as const;

export default function ToolsPanel({ onDataChanged, defaultTool = 'item-coverage' }: ToolsPanelProps) {
  const [active, setActive] = useState<string>(defaultTool);

  const renderTool = () => {
    switch (active) {
      case 'item-coverage':
        return <div className="h-full overflow-auto"><ItemCoverageAnalyzer /></div>;
      case 'archetype-maintenance':
        return <div className="h-full overflow-auto"><ArchetypeMaintenancePanel onDataChanged={onDataChanged} /></div>;
      case 'unique-reclaim':
        return <div className="h-full overflow-auto"><UniqueReclaimManager /></div>;
      case 'credit-drain':
        return <div className="h-full overflow-auto"><CreditDrainHistory /></div>;
      default:
        return null;
    }
  };

  return (
    <AdminPageShell
      icon={<Wrench className="w-4 h-4" />}
      title="Tools"
      tools={
        <nav className="p-2 space-y-1">
          {TOOLS.map((t) => {
            const Icon = t.icon;
            const isActive = active === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActive(t.key)}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-muted/50 text-foreground',
                )}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{t.label}</span>
              </button>
            );
          })}
        </nav>
      }
    >
      {renderTool()}
    </AdminPageShell>
  );
}
