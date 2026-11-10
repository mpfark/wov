import { useState } from 'react';
import { Activity, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  status: string;
  encounterId: string | null;
  tick: number | null;
  cursor: number;
  character: { hp: number; max_hp: number; cp: number; max_cp: number; mp: number; max_mp: number };
  reservedCp: number;
  actionsReady: boolean;
}

/** Reads the same accepted projection as the player screen; never runs a tick. */
export function EngineSessionInspector(props: Props) {
  const [open, setOpen] = useState(false);
  if (!open) return <Button variant="outline" size="icon" className="fixed bottom-3 right-28 z-50 h-8 w-8"
    aria-label="Open engine session" title="Engine session" onClick={() => setOpen(true)}><Activity className="h-4 w-4" /></Button>;
  const rows = [
    ['Session', props.status], ['Encounter', props.encounterId ? `#${props.encounterId.slice(0, 6)}` : 'None'],
    ['Encounter tick', props.tick ?? '—'], ['Delivery cursor', props.cursor],
    ['Actions', props.actionsReady ? 'Ready' : 'Blocked'],
    ['HP', `${props.character.hp}/${props.character.max_hp}`],
    ['CP', `${props.character.cp}/${props.character.max_cp}`], ['Reserved CP', props.reservedCp],
    ['MP', `${props.character.mp}/${props.character.max_mp}`],
  ];
  return <section aria-label="Engine session" className="fixed bottom-3 right-3 z-50 w-80 max-w-[calc(100vw-1.5rem)] border border-border rounded-md bg-background shadow-xl p-3">
    <header className="flex items-center justify-between mb-2"><h2 className="font-display text-sm">Engine session</h2>
      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Close engine session" onClick={() => setOpen(false)}><X className="h-4 w-4" /></Button></header>
    <dl className="space-y-1 text-xs">{rows.map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="text-foreground tabular-nums break-all">{value}</dd></div>)}</dl>
  </section>;
}