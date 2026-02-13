import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface GameNode {
  id: string;
  region_id: string;
  name: string;
  description: string;
  connections: Array<{ node_id: string; direction: string; label?: string; hidden?: boolean }>;
  searchable_items: string[];
  is_vendor: boolean;
  is_inn: boolean;
  is_blacksmith: boolean;
}

export interface Region {
  id: string;
  name: string;
  description: string;
  min_level: number;
  max_level: number;
}

export function useNodes(isAuthenticated: boolean = false) {
  const [regions, setRegions] = useState<Region[]>([]);
  const [nodes, setNodes] = useState<GameNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    const fetchAll = async () => {
      const [regRes, nodeRes] = await Promise.all([
        supabase.from('regions').select('*'),
        supabase.from('nodes').select('*'),
      ]);
      if (regRes.data) setRegions(regRes.data as Region[]);
      if (nodeRes.data) setNodes(nodeRes.data as unknown as GameNode[]);
      setLoading(false);
    };
    fetchAll();
  }, [isAuthenticated]);

  const getNode = (nodeId: string) => nodes.find(n => n.id === nodeId);
  const getRegion = (regionId: string) => regions.find(r => r.id === regionId);
  const getRegionNodes = (regionId: string) => nodes.filter(n => n.region_id === regionId);

  return { regions, nodes, loading, getNode, getRegion, getRegionNodes };
}
