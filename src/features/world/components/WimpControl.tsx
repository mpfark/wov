import { useEffect, useRef, useState } from 'react';
import { Character } from '@/features/character';
import { useGameContext } from '@/contexts/GameContext';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ShieldAlert } from 'lucide-react';

interface Props {
  character: Character;
}

const DIRECTIONS: Array<{ value: string; label: string; arrow: string }> = [
  { value: 'NW', label: 'Northwest', arrow: '↖' },
  { value: 'N',  label: 'North',     arrow: '↑' },
  { value: 'NE', label: 'Northeast', arrow: '↗' },
  { value: 'W',  label: 'West',      arrow: '←' },
  { value: '',   label: 'Off',       arrow: '·' },
  { value: 'E',  label: 'East',      arrow: '→' },
  { value: 'SW', label: 'Southwest', arrow: '↙' },
  { value: 'S',  label: 'South',     arrow: '↓' },
  { value: 'SE', label: 'Southeast', arrow: '↘' },
];

const ARROW_FOR: Record<string, string> = Object.fromEntries(
  DIRECTIONS.filter(d => d.value).map(d => [d.value, d.arrow])
);

/**
 * Compact bottom-toolbar Wimp control: HP threshold input + compass picker.
 * Auto-saves on change (debounced) via GameContext.updateCharacter.
 */
export default function WimpControl({ character }: Props) {
  const { updateCharacter } = useGameContext();
  const [threshold, setThreshold] = useState<number>(character.wimp_hp_threshold ?? 0);
  const [direction, setDirection] = useState<string>(character.wimp_direction ?? '');
  const [open, setOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync when the underlying character changes (e.g. character swap).
  useEffect(() => {
    setThreshold(character.wimp_hp_threshold ?? 0);
    setDirection(character.wimp_direction ?? '');
  }, [character.id, character.wimp_hp_threshold, character.wimp_direction]);

  const persist = (nextThreshold: number, nextDirection: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void updateCharacter({
        wimp_hp_threshold: nextThreshold,
        wimp_direction: nextDirection || null,
      } as Partial<Character>);
    }, 400);
  };

  const active = threshold > 0 && !!direction;
  const baseClass = `h-5 flex items-center gap-0.5 rounded border text-[10px] transition-colors ${
    active
      ? 'bg-primary/15 border-primary/50 text-primary shadow-[0_0_6px_hsl(var(--primary)/0.35)]'
      : 'bg-background/70 border-border/50 text-muted-foreground hover:bg-muted/60'
  }`;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`${baseClass} px-1`}>
            <ShieldAlert className="h-3 w-3 shrink-0" />
            <input
              type="number"
              min={0}
              max={character.max_hp}
              value={threshold}
              onChange={e => {
                const v = Math.max(0, Math.min(character.max_hp, Number(e.target.value) || 0));
                setThreshold(v);
                persist(v, direction);
              }}
              className="w-9 h-4 px-0.5 bg-transparent border-0 text-right t-numeric focus:outline-none focus:ring-1 focus:ring-primary/40 rounded-sm"
              aria-label="Wimp HP threshold"
            />
            <span className="opacity-60">HP</span>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <button
                  className="h-4 w-5 ml-0.5 flex items-center justify-center rounded-sm border border-border/40 bg-background/60 hover:bg-muted/60 text-xs leading-none"
                  aria-label="Wimp direction"
                >
                  {direction ? ARROW_FOR[direction] : '–'}
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" align="center" className="w-auto p-1.5">
                <div className="grid grid-cols-3 gap-0.5">
                  {DIRECTIONS.map(d => {
                    const selected = d.value === direction;
                    return (
                      <button
                        key={d.label}
                        title={d.label}
                        onClick={() => {
                          setDirection(d.value);
                          persist(threshold, d.value);
                          setOpen(false);
                        }}
                        className={`h-7 w-7 flex items-center justify-center rounded text-sm transition-colors ${
                          selected
                            ? 'bg-primary/25 border border-primary/60 text-primary'
                            : 'bg-background/60 border border-border/40 text-foreground hover:bg-muted/60'
                        }`}
                      >
                        {d.arrow}
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Wimp: auto-flee when HP ≤ threshold
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
