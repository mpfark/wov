import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Map,
  PawPrint,
  User,
  Swords,
  Users,
  MapPin,
  Bug,
  Layers,
} from 'lucide-react';

interface AdminDashboardProps {
  onNavigate: (tab: string) => void;
}

interface Counts {
  regions: number;
  nodes: number;
  areas: number;
  creatures: number;
  npcs: number;
  items: number;
  users: number;
  issues: number;
}

const CARDS = [
  { key: 'regions', label: 'Regions', icon: Layers, tab: 'world' },
  { key: 'nodes', label: 'Nodes', icon: Map, tab: 'world' },
  { key: 'areas', label: 'Areas', icon: MapPin, tab: 'world' },
  { key: 'creatures', label: 'Creatures', icon: PawPrint, tab: 'creatures' },
  { key: 'npcs', label: 'NPCs', icon: User, tab: 'npcs' },
  { key: 'items', label: 'Items', icon: Swords, tab: 'items' },
  { key: 'users', label: 'Users', icon: Users, tab: 'users' },
  { key: 'issues', label: 'Open Issues', icon: Bug, tab: 'issues' },
] as const;

export default function AdminDashboard({ onNavigate }: AdminDashboardProps) {
  const [counts, setCounts] = useState<Counts>({
    regions: 0, nodes: 0, areas: 0, creatures: 0, npcs: 0, items: 0, users: 0, issues: 0,
  });

  useEffect(() => {
    const load = async () => {
      const [regions, nodes, areas, creatures, npcs, items, issues] = await Promise.all([
        supabase.from('regions').select('id', { count: 'exact', head: true }),
        supabase.from('nodes').select('id', { count: 'exact', head: true }),
        supabase.from('areas').select('id', { count: 'exact', head: true }),
        supabase.from('creatures').select('id', { count: 'exact', head: true }),
        supabase.from('npcs').select('id', { count: 'exact', head: true }),
        supabase.from('items').select('id', { count: 'exact', head: true }),
        supabase.from('issue_reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
      ]);

      // user count via edge function or profiles
      const profileRes = await supabase.from('profiles').select('id', { count: 'exact', head: true });

      setCounts({
        regions: regions.count ?? 0,
        nodes: nodes.count ?? 0,
        areas: areas.count ?? 0,
        creatures: creatures.count ?? 0,
        npcs: npcs.count ?? 0,
        items: items.count ?? 0,
        users: profileRes.count ?? 0,
        issues: issues.count ?? 0,
      });
    };
    load();
  }, []);

  return (
    <div className="p-6 overflow-y-auto">
      <div className="mb-6">
        <h2 className="font-display text-lg text-primary mb-1">Welcome back</h2>
        <p className="text-sm text-muted-foreground">Quick overview of the world state.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {CARDS.map((card) => (
          <Card
            key={card.key}
            className="cursor-pointer hover:border-primary/40 transition-colors"
            onClick={() => onNavigate(card.tab)}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0 p-4">
              <CardTitle className="text-xs font-display text-muted-foreground">{card.label}</CardTitle>
              <card.icon className="h-4 w-4 text-primary/60" />
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-display text-foreground">
                {counts[card.key]}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
