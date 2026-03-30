import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type AreaType = string;

export interface Area {
  id: string;
  region_id: string;
  name: string;
  description: string;
  area_type: string;
  created_at: string;
  min_level?: number;
  max_level?: number;
  creature_types?: string;
  flavor_text?: string;
}

export interface GameNode {
  id: string;
  region_id: string;
  name: string;
  description: string;
  connections: Array<{ node_id: string; direction: string; label?: string; hidden?: boolean; locked?: boolean; lock_key?: string }>;
  searchable_items: string[];
  is_vendor: boolean;
  is_inn: boolean;
  is_blacksmith: boolean;
  is_teleport: boolean;
  is_trainer: boolean;
  area_id?: string | null;
  x: number;
  y: number;
}

export interface Region {
  id: string;
  name: string;
  description: string;
  min_level: number;
  max_level: number;
}

/** Get the display name for a node: node.name if set, otherwise area name, otherwise fallback */
export function getNodeDisplayName(node: GameNode, area?: Area | null): string {
  if (node.name && node.name.trim()) return node.name;
  if (area) return area.name;
  return 'Unknown Location';
}

/** Get the display description for a node: node.description if set, otherwise area description */
export function getNodeDisplayDescription(node: GameNode, area?: Area | null): string {
  if (node.description && node.description.trim()) return node.description;
  if (area) return area.description;
  return '';
}

export function useNodes(isAuthenticated: boolean = false) {
  const [regions, setRegions] = useState<Region[]>([]);
  const [nodes, setNodes] = useState<GameNode[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    const fetchAll = async () => {
      const [regRes, nodeRes, areaRes] = await Promise.all([
        supabase.from('regions').select('*'),
        supabase.from('nodes').select('*'),
        supabase.from('areas').select('*'),
      ]);
      if (regRes.data) setRegions(regRes.data as Region[]);
      if (nodeRes.data) setNodes(nodeRes.data as unknown as GameNode[]);
      if (areaRes.data) setAreas(areaRes.data as unknown as Area[]);
      setLoading(false);
    };
    fetchAll();
  }, [isAuthenticated]);

  const getNode = useCallback((nodeId: string) => nodes.find(n => n.id === nodeId), [nodes]);
  const getRegion = useCallback((regionId: string) => regions.find(r => r.id === regionId), [regions]);
  const getRegionNodes = useCallback((regionId: string) => nodes.filter(n => n.region_id === regionId), [nodes]);
  const getArea = useCallback((areaId: string) => areas.find(a => a.id === areaId), [areas]);
  const getAreaNodes = useCallback((areaId: string) => nodes.filter(n => n.area_id === areaId), [nodes]);
  const getNodeArea = useCallback((node: GameNode) => node.area_id ? areas.find(a => a.id === node.area_id) : undefined, [areas]);

  return { regions, nodes, areas, loading, getNode, getRegion, getRegionNodes, getArea, getAreaNodes, getNodeArea };
}
