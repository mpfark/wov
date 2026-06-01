import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Wrench } from 'lucide-react';
import { AdminEntityToolbar } from './common';
import ItemForgePanel from './ItemForgePanel';
import ItemCoverageAnalyzer from './ItemCoverageAnalyzer';
import UniqueReclaimManager from './UniqueReclaimManager';
import CreditDrainHistory from './CreditDrainHistory';

interface ToolsPanelProps {
  onDataChanged?: () => void;
  defaultTab?: string;
}

export default function ToolsPanel({ onDataChanged, defaultTab = 'item-forge' }: ToolsPanelProps) {
  return (
    <div className="h-full flex flex-col min-h-0">
      <AdminEntityToolbar icon={<Wrench className="w-4 h-4" />} title="Tools" />
      <Tabs defaultValue={defaultTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="shrink-0 mx-3 mt-2">
          <TabsTrigger value="item-forge" className="text-xs">🔨 Item Forge</TabsTrigger>
          <TabsTrigger value="item-coverage" className="text-xs">📊 Item Coverage</TabsTrigger>
          <TabsTrigger value="unique-reclaim" className="text-xs">👑 Unique Reclaim</TabsTrigger>
          <TabsTrigger value="credit-drain" className="text-xs">✨ Credit Drain</TabsTrigger>
        </TabsList>
        <TabsContent value="item-forge" className="flex-1 min-h-0 overflow-hidden mt-0">
          <ItemForgePanel onDataChanged={onDataChanged} />
        </TabsContent>
        <TabsContent value="item-coverage" className="flex-1 min-h-0 overflow-auto mt-0">
          <ItemCoverageAnalyzer />
        </TabsContent>
        <TabsContent value="unique-reclaim" className="flex-1 min-h-0 overflow-auto mt-0">
          <UniqueReclaimManager />
        </TabsContent>
        <TabsContent value="credit-drain" className="flex-1 min-h-0 overflow-auto mt-0">
          <CreditDrainHistory />
        </TabsContent>
      </Tabs>
    </div>
  );
}
