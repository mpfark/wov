import { useState } from 'react';
import { Activity, BookOpen, ShieldCheck, Zap } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Combat2TestArenaPanel from '@/components/admin/Combat2TestArenaPanel';
import AbilityConfigManager from '@/components/admin/AbilityConfigManager';
import StatusManager from '@/components/admin/StatusManager';
import ClassConfigManager from '@/components/admin/ClassConfigManager';

/** One engine workspace, reusing the installed arena and configured authoring boundaries. */
export type EngineAdminTab = 'arena' | 'abilities' | 'statuses' | 'classes';

export default function EngineAdminWorkspace({ initialTab = 'arena' }: { initialTab?: EngineAdminTab }) {
  const [tab, setTab] = useState<string>(initialTab);
  return <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0 h-full">
    <header className="border-b border-border px-3 py-3 flex flex-wrap items-center gap-3">
      <h1 className="font-display text-lg flex items-center gap-2"><Activity className="h-5 w-5 text-primary" />Game Engine</h1>
      <TabsList className="h-auto flex flex-wrap justify-start gap-1">
        <TabsTrigger value="arena" className="text-xs gap-1"><ShieldCheck className="h-3 w-3" />Test Arena</TabsTrigger>
        <TabsTrigger value="abilities" className="text-xs gap-1"><Zap className="h-3 w-3" />Abilities</TabsTrigger>
        <TabsTrigger value="statuses" className="text-xs gap-1"><Activity className="h-3 w-3" />Statuses</TabsTrigger>
        <TabsTrigger value="classes" className="text-xs gap-1"><BookOpen className="h-3 w-3" />Classes</TabsTrigger>
      </TabsList>
    </header>
    <TabsContent value="arena" className="flex-1 min-h-0 mt-0 data-[state=active]:flex flex-col"><Combat2TestArenaPanel /></TabsContent>
    <TabsContent value="abilities" className="flex-1 min-h-0 mt-0 data-[state=active]:flex flex-col"><AbilityConfigManager /></TabsContent>
    <TabsContent value="statuses" className="flex-1 min-h-0 mt-0 data-[state=active]:flex flex-col"><StatusManager /></TabsContent>
    <TabsContent value="classes" className="flex-1 min-h-0 mt-0 data-[state=active]:flex flex-col"><ClassConfigManager /></TabsContent>
  </Tabs>;
}