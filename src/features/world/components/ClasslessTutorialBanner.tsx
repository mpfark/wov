import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { CLASS_LABELS } from '@/shared/formulas/classes';

interface HallRow {
  id: string;
  name: string;
  class_hall: string;
  region_id: string | null;
  area_id: string | null;
}

interface RegionRow { id: string; name: string }
interface AreaRow { id: string; name: string }

/**
 * Banner shown to Classless Adventurers, listing the seven Order Halls in
 * the world so they know where to seek a Recruiter. Self-contained: queries
 * the halls once on mount and groups by class.
 */
export default function ClasslessTutorialBanner() {
  const [halls, setHalls] = useState<HallRow[]>([]);
  const [regions, setRegions] = useState<Record<string, string>>({});
  const [areas, setAreas] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: hallRows } = await supabase
        .from('nodes')
        .select('id, name, class_hall, region_id, area_id')
        .not('class_hall', 'is', null);
      if (cancelled || !hallRows) return;
      setHalls(hallRows as unknown as HallRow[]);

      const regionIds = Array.from(new Set(hallRows.map((h: any) => h.region_id).filter(Boolean)));
      const areaIds = Array.from(new Set(hallRows.map((h: any) => h.area_id).filter(Boolean)));
      if (regionIds.length) {
        const { data: r } = await supabase.from('regions').select('id, name').in('id', regionIds);
        if (r && !cancelled) setRegions(Object.fromEntries((r as RegionRow[]).map(x => [x.id, x.name])));
      }
      if (areaIds.length) {
        const { data: a } = await supabase.from('areas').select('id, name').in('id', areaIds);
        if (a && !cancelled) setAreas(Object.fromEntries((a as AreaRow[]).map(x => [x.id, x.name])));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const ALL_CLASSES = ['warrior', 'wizard', 'ranger', 'rogue', 'healer', 'bard', 'templar'];

  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-3 my-2 text-xs">
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="flex items-center justify-between w-full text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-base">🧭</span>
          <span className="font-display text-primary text-glow">
            You are a Classless Adventurer
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground">{collapsed ? 'Show' : 'Hide'}</span>
      </button>

      {!collapsed && (
        <div className="mt-2 space-y-2">
          <p className="text-foreground/80 leading-snug">
            Seek an <span className="text-primary">Order Hall</span> (🏰) in the world and speak to its
            Recruiter to swear yourself to a class. You can change orders later at any other hall.
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
            {ALL_CLASSES.map(cls => {
              const hall = halls.find(h => h.class_hall === cls);
              return (
                <li key={cls} className="flex items-center justify-between gap-2">
                  <span className="font-display text-foreground/90">
                    🏰 {CLASS_LABELS[cls] ?? cls}
                  </span>
                  <span className="text-muted-foreground text-[11px] truncate">
                    {hall
                      ? (hall.name?.trim() || (hall.area_id && areas[hall.area_id]) || 'Unknown')
                        + (hall.region_id && regions[hall.region_id] ? ` · ${regions[hall.region_id]}` : '')
                      : <span className="italic opacity-60">not yet established</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
