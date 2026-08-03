/**
 * AssignmentMatrix — Phase 6: per-class overview of the five ability slots,
 * showing each slot's default technique and its player-selectable alternatives.
 *
 * Read-only navigation: clicking an entry selects it in the editor. It renders
 * the same rows the editor already loaded, so it can never drift from the
 * configuration it describes.
 */
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CLASS_LABELS } from '@/lib/game-data';
import { damageTypeLabel } from '@/shared/combat/damage-types';

export interface MatrixRow {
  assignment_id: string;
  class_key: string;
  slot: number;
  role_name: string;
  role_id: string;
  label: string;
  cp_cost: number;
  unlock_level: number;
  is_default: boolean;
  damage_type: string | null;
  ability_status: string;
  assignment_status: string;
}

interface Props {
  rows: MatrixRow[];
  onSelect: (assignmentId: string) => void;
}

export default function AssignmentMatrix({ rows, onSelect }: Props) {
  const classes = [...new Set(rows.map(r => r.class_key))].sort();

  return (
    <div className="p-4 space-y-4 max-w-3xl">
      <p className="text-xs text-muted-foreground">
        Select an ability on the left to edit its text, cost, taxonomy and magnitude formulas —
        or pick one from the matrix below.
      </p>
      {classes.map(classKey => {
        const slots = [...new Set(rows.filter(r => r.class_key === classKey).map(r => r.slot))]
          .sort((a, b) => a - b);
        return (
          <Card key={classKey} className="bg-card/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-display">
                {CLASS_LABELS[classKey] ?? classKey}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {slots.map(slot => {
                const inSlot = rows
                  .filter(r => r.class_key === classKey && r.slot === slot)
                  .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.label.localeCompare(b.label));
                const roleName = inSlot[0]?.role_name ?? `Slot ${slot}`;
                return (
                  <div key={slot} className="flex items-start gap-3">
                    <div className="w-32 shrink-0 pt-1">
                      <p className="text-[11px] font-semibold">{roleName}</p>
                      <p className="text-[10px] text-muted-foreground">slot {slot}</p>
                    </div>
                    <div className="flex-1 flex flex-wrap gap-1.5">
                      {inSlot.map(r => (
                        <button
                          key={r.assignment_id}
                          onClick={() => onSelect(r.assignment_id)}
                          className={`px-2 py-1 rounded border text-[11px] transition-colors ${
                            r.is_default
                              ? 'border-primary/60 bg-primary/10 hover:bg-primary/20'
                              : 'border-border/60 hover:bg-muted/40'
                          }`}
                        >
                          {r.label}
                          <span className="ml-1.5 text-[10px] text-muted-foreground">
                            {r.cp_cost} CP · L{r.unlock_level}
                          </span>
                          {r.damage_type && (
                            <Badge variant="outline" className="ml-1 text-[9px]">
                              {damageTypeLabel(r.damage_type)}
                            </Badge>
                          )}
                          {!r.is_default && (
                            <Badge variant="outline" className="ml-1 text-[9px] border-primary/50 text-primary">alt</Badge>
                          )}
                          {(r.ability_status !== 'active' || r.assignment_status !== 'active') && (
                            <Badge variant="secondary" className="ml-1 text-[9px] capitalize">
                              {r.ability_status !== 'active' ? r.ability_status : r.assignment_status}
                            </Badge>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
