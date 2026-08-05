/**
 * AssignmentOverview — read-only cross-class view of which base ability fills
 * every class slot. It replaces the deleted AssignmentMatrix in class scope:
 * reporting only, no assignment controls, so Class Config stays the single
 * writer through `ClassAbilityConfig`.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  buildAssignmentOverview, type OverviewRow, type SlotHealth,
} from './assignment-overview';

const HEALTH_TEXT: Record<SlotHealth, string> = {
  ok: '',
  empty: 'no active ability',
  no_default: 'no default',
  multi_default: 'multiple defaults',
};

interface Props {
  /** Highlights the class currently being edited. */
  highlightClassKey?: string | null;
}

export default function AssignmentOverview({ highlightClassKey }: Props) {
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [classRes, roleRes, assignRes] = await Promise.all([
      supabase.from('classes').select('class_key, label, sort_order'),
      supabase.from('class_ability_roles').select('id, class_key, slot, name'),
      supabase.from('class_ability_assignments')
        .select('class_key, role_id, status, is_default, ability:abilities ( ability_key, label )'),
    ]);
    setLoading(false);
    if (classRes.error || roleRes.error || assignRes.error) {
      toast.error((classRes.error ?? roleRes.error ?? assignRes.error)!.message);
      return;
    }
    const assignments = (assignRes.data ?? [])
      .filter((a: any) => a.ability)
      .map((a: any) => ({
        class_key: a.class_key,
        role_id: a.role_id,
        status: a.status ?? 'active',
        is_default: !!a.is_default,
        ability_label: a.ability.label as string,
        ability_key: a.ability.ability_key as string,
      }));
    setRows(buildAssignmentOverview(
      (classRes.data ?? []) as never,
      (roleRes.data ?? []) as never,
      assignments,
    ));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Card className="bg-card/80">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-display">Assignment overview (read-only)</CardTitle>
        <p className="text-[11px] text-muted-foreground">
          Every class slot and the base ability that fills it. Edit assignments in the class
          above — this view only reports coverage.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading overview…
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map(row => (
              <div
                key={row.classKey}
                className={cn(
                  'rounded border p-2',
                  row.classKey === highlightClassKey
                    ? 'border-primary/60 bg-primary/5'
                    : 'border-border/60',
                )}
              >
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {row.label}
                  {row.issues > 0 && (
                    <Badge variant="secondary" className="ml-2 text-[9px]">
                      {row.issues} slot{row.issues > 1 ? 's' : ''} need attention
                    </Badge>
                  )}
                </p>
                <div className="mt-1 grid gap-1">
                  {row.slots.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">No slots defined.</p>
                  )}
                  {row.slots.map(slot => (
                    <div key={slot.roleId} className="flex items-baseline gap-2 text-xs">
                      <span className="w-32 shrink-0 text-muted-foreground">
                        Slot {slot.slot} · {slot.name}
                      </span>
                      <span className="flex-1">
                        {slot.defaultLabel ?? <span className="text-muted-foreground">—</span>}
                        {slot.alternatives.map(alt => (
                          <Badge
                            key={alt}
                            variant="outline"
                            className="ml-1 text-[9px] border-primary/50 text-primary"
                          >
                            {alt}
                          </Badge>
                        ))}
                      </span>
                      {slot.health !== 'ok' && (
                        <span className="text-[10px] text-destructive">
                          {HEALTH_TEXT[slot.health]}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
