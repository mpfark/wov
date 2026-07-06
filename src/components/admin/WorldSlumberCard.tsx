import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Moon, Sun, ChevronDown, ChevronUp } from 'lucide-react';
import { useWorldSlumberState } from '@/hooks/useWorldSlumberState';

function formatAgo(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h ago`;
}

export function WorldSlumberCard() {
  const { currentState, awakeNow, lastChangeAt, recent, loading } = useWorldSlumberState(true);
  const [open, setOpen] = useState(false);

  if (loading) {
    return (
      <Card className="mb-4">
        <CardContent className="p-3 text-xs text-muted-foreground">Loading world state…</CardContent>
      </Card>
    );
  }

  const asleep = currentState === 'asleep';
  const Icon = asleep ? Moon : Sun;

  return (
    <Card className="mb-4">
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div
              className={
                asleep
                  ? 'flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-muted/40 text-muted-foreground'
                  : 'flex items-center gap-2 px-3 py-1.5 rounded-md border border-primary/40 bg-primary/10 text-primary text-glow'
              }
            >
              <Icon className="h-4 w-4" />
              <span className="t-label text-[11px] uppercase tracking-wide">
                World {asleep ? 'asleep' : 'awake'}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {asleep ? (
                <>No players active. Cron jobs are short-circuiting. Last awake {formatAgo(lastChangeAt)}.</>
              ) : (
                <>{awakeNow} player{awakeNow === 1 ? '' : 's'} online in the last 5 min. Awake since {formatAgo(lastChangeAt)}.</>
              )}
            </div>
          </div>
          {recent.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setOpen(o => !o)} className="text-xs">
              {open ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
              History
            </Button>
          )}
        </div>

        {open && recent.length > 0 && (
          <div className="mt-3 border-t border-border pt-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Recent transitions</div>
            <ul className="space-y-1 text-xs">
              {recent.map(r => (
                <li key={r.id} className="flex items-center gap-2">
                  {r.state === 'asleep'
                    ? <Moon className="h-3 w-3 text-muted-foreground" />
                    : <Sun className="h-3 w-3 text-primary" />}
                  <span className="w-16 capitalize">{r.state}</span>
                  <span className="text-muted-foreground">
                    {new Date(r.changed_at).toLocaleString()}
                  </span>
                  <span className="text-muted-foreground ml-auto">
                    {r.awake_characters} active
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
