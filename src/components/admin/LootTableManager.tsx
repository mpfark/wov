import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PoolRulesTab from './loot/PoolRulesTab';
import ItemPoolTab from './loot/ItemPoolTab';
import LegacyLootTablesTab from './loot/LegacyLootTablesTab';
import CreatureLootModesTab from './loot/CreatureLootModesTab';

export default function LootTableManager() {
  return (
    <Tabs defaultValue="rules" className="h-full flex flex-col">
      <TabsList className="shrink-0 mx-3 mt-2">
        <TabsTrigger value="rules" className="text-xs">⚙️ Pool Rules</TabsTrigger>
        <TabsTrigger value="items" className="text-xs">📦 Item Pool</TabsTrigger>
        <TabsTrigger value="legacy" className="text-xs">📋 Legacy Tables</TabsTrigger>
        <TabsTrigger value="creatures" className="text-xs">🐾 Creature Modes</TabsTrigger>
      </TabsList>
      <TabsContent value="rules" className="flex-1 overflow-auto mt-0">
        <PoolRulesTab />
      </TabsContent>
      <TabsContent value="items" className="flex-1 overflow-hidden mt-0">
        <ItemPoolTab />
      </TabsContent>
      <TabsContent value="legacy" className="flex-1 overflow-hidden mt-0">
        <LegacyLootTablesTab />
      </TabsContent>
      <TabsContent value="creatures" className="flex-1 overflow-hidden mt-0">
        <CreatureLootModesTab />
      </TabsContent>
    </Tabs>
  );
}
