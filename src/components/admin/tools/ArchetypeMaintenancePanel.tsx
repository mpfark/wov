import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRole } from '@/hooks/useRole';
import { toast } from 'sonner';
import { Loader2, Flame, Sparkles } from 'lucide-react';

interface ArchetypeMaintenancePanelProps {
  onDataChanged?: () => void;
}

export default function ArchetypeMaintenancePanel({ onDataChanged }: ArchetypeMaintenancePanelProps = {}) {
  const { user } = useAuth();
  const { isValar } = useRole(user);
  const [seeding, setSeeding] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const seedCatalog = async () => {
    setSeeding(true);
    try {
      const { data, error } = await supabase.functions.invoke('seed-archetype-items', {
        body: { purge: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(
        `Catalog rebuilt — purged ${data.purged}, inserted ${data.inserted}, ` +
        `${data.starting_gear_attached} starter items wired.`
      );
      onDataChanged?.();
    } catch (e: any) {
      toast.error(e.message || 'Seed failed');
    } finally {
      setSeeding(false);
    }
  };

  const rebuildStats = async () => {
    setRebuilding(true);
    try {
      const { data, error } = await supabase.functions.invoke('rebuild-archetype-stats', {
        body: {},
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(
        `Stats rewritten — processed ${data.processed}, updated ${data.updated}, skipped ${data.skipped}.`
      );
      onDataChanged?.();
    } catch (e: any) {
      toast.error(e.message || 'Rebuild failed');
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <div className="p-4 space-y-4 max-w-2xl">
      <div>
        <h2 className="t-display-sm mb-1">Archetype Maintenance</h2>
        <p className="t-meta">Rebuild and rewrite the deterministic common/uncommon archetype catalog.</p>
      </div>

      {/* Purge & Seed (Overlord only) */}
      {isValar && (
        <div className="rounded border border-primary/30 bg-primary/5 p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-display text-primary uppercase tracking-wider">Purge & Seed Catalog</span>
          </div>
          <p className="text-xs text-muted-foreground leading-snug">
            Hard-purges all common/uncommon items and rebuilds the deterministic archetype catalog.
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" disabled={seeding} className="text-xs">
                {seeding ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Rebuilding…</> : <><Flame className="w-3 h-3 mr-1" />Purge & Seed Catalog</>}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Rebuild common & uncommon item catalog?</AlertDialogTitle>
                <AlertDialogDescription>
                  This deletes every existing common and uncommon item — including any copies in player inventories, vendors, marketplace listings, ground loot and loot tables — and replaces them with the deterministic archetype catalog. Uniques, soulforged, boss and quest items are not touched. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={seedCatalog}>Purge & Rebuild</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {/* Rewrite Stats */}
      <div className="rounded border border-elvish/30 bg-elvish/5 p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-elvish" />
          <span className="text-xs font-display text-elvish uppercase tracking-wider">Rewrite Stats (Squish v2)</span>
        </div>
        <p className="text-xs text-muted-foreground leading-snug">
          Rewrites every existing common/uncommon equipment item in place using the new −20% budget and 3-stat distribution (70/20/10 common, 50/30/20 uncommon). Names, slots and IDs are preserved. Uniques, soulforged and consumables are untouched.
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline" disabled={rebuilding} className="text-xs">
              {rebuilding ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Rewriting…</> : <><Sparkles className="w-3 h-3 mr-1" />Rewrite Existing Stats</>}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Rewrite all existing common & uncommon stats?</AlertDialogTitle>
              <AlertDialogDescription>
                This updates the stat block on every common and uncommon equipment item to match the new squish-v2 budget and 3-stat distribution. Player-equipped items will pick up the new stats on their next resource sync. Idempotent — safe to re-run.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={rebuildStats}>Rewrite Stats</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
