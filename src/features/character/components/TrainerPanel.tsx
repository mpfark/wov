import { useState, useEffect, useCallback } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ServicePanelShell, ServicePanelEmpty, useMiniLog } from '@/components/ui/ServicePanelShell';
import { Character } from '@/features/character';
import { supabase } from '@/integrations/supabase/client';
import { StatPlannerBody } from '@/features/character/components/StatPlannerDialog';
import { buildErrorEvent } from '@/features/combat/events/client-event-builder';
import type { GameLogEvent } from '@/features/combat/events/log-event';
import { Button } from '@/components/ui/button';
import { pendingProgressionAction } from '../progression-command';
import type { ProgressionStat } from '../../../../supabase/functions/_shared/progression-command';

// NOTE: `character.bhp` is legacy storage for the current Renown balance.
// `character.bhp_trained` is legacy storage for Renown training ranks.

interface LeaderRow {
  id: string;
  name: string;
  level: number;
  class: string;
  rp_total_earned: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  character: Character;
  equipmentBonuses: Record<string, number>;
  addLogEvent: (event: GameLogEvent) => void;
  /** Called by allocate/respec flows to commit a batch / refund. */
  onBatchAllocateStats: (allocations: Record<string, number>) => Promise<boolean>;
  onFullRespec: () => Promise<boolean>;
  onRenown: (stat: ProgressionStat) => Promise<boolean>;
  /** Optional NPC framing (when opened by talking to a service-role trainer). */
  npcName?: string;
  npcFlavor?: string;
}

type TrainerTab = 'allocate' | 'renown' | 'leaderboard';

export default function TrainerPanel({
  open, onClose, character, equipmentBonuses, addLogEvent: parentAddLogEvent,
  onBatchAllocateStats, onFullRespec, onRenown, npcName, npcFlavor,
}: Props) {
  const { entries: miniLog, addEvent } = useMiniLog(parentAddLogEvent);

  const [tab, setTab] = useState<TrainerTab>('allocate');
  const pending = pendingProgressionAction(character.id);
  const [selectedStat, setSelectedStat] = useState<ProgressionStat>(() => pending && 'stat' in pending ? pending.stat : 'str');
  const [submitting, setSubmitting] = useState(false);
  const submit = async (operation: 'respec' | 'renown') => {
    if (submitting) return;
    setSubmitting(true);
    try { await (operation === 'respec' ? onFullRespec() : onRenown(selectedStat)); }
    finally { setSubmitting(false); }
  };

  const [leaders, setLeaders] = useState<LeaderRow[] | null>(null);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(false);

  // Default tab: prefer Allocate if points pending or respec available, else Renown.
  useEffect(() => {
    if (!open) return;
    if (character.unspent_stat_points > 0 || (character.respec_points || 0) > 0) setTab('allocate');
    else setTab('renown');
  }, [open, character.unspent_stat_points, character.respec_points]);

  // ── Leaderboard ──
  const fetchLeaderboard = useCallback(async () => {
    setLoadingBoard(true);
    try {
      const { data, error } = await supabase.rpc('get_renown_leaderboard', { _limit: 25 });
      if (error) throw error;
      const rows = (data || []) as LeaderRow[];
      setLeaders(rows);

      const inTop = rows.some(r => r.id === character.id);
      if (!inTop && (character.rp_total_earned || 0) > 0) {
        const { data: rankData } = await supabase.rpc('get_renown_rank', { _character_id: character.id });
        setMyRank(typeof rankData === 'number' ? rankData : null);
      } else {
        setMyRank(null);
      }
    } catch (e: any) {
      addEvent(buildErrorEvent(`Failed to load leaderboard: ${e.message || 'Unknown error'}`));
      setLeaders([]);
    }
    setLoadingBoard(false);
  }, [character.id, character.rp_total_earned, addEvent]);

  useEffect(() => {
    if (open && tab === 'leaderboard' && leaders === null) {
      fetchLeaderboard();
    }
  }, [open, tab, leaders, fetchLeaderboard]);

  useEffect(() => {
    if (!open) {
      setLeaders(null);
      setMyRank(null);
    }
  }, [open]);

  // ── Tabs ──
  const tabsRow = (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TrainerTab)} className="w-full">
      <TabsList className="grid grid-cols-3 w-full bg-surface-3/60">
        <TabsTrigger value="allocate" className="t-label text-[11px] data-[state=active]:text-primary relative">
          Allocate
          {(character.unspent_stat_points > 0 || (character.respec_points || 0) > 0) && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary animate-pulse" />
          )}
        </TabsTrigger>
        <TabsTrigger value="renown" className="t-label text-[11px] data-[state=active]:text-primary">Renown</TabsTrigger>
        <TabsTrigger value="leaderboard" className="t-label text-[11px] data-[state=active]:text-primary">Board</TabsTrigger>
      </TabsList>
    </Tabs>
  );

  // ── Allocate tab (includes respec) ──
  const respecAvailable = true;
  const hasAnythingToDo = character.unspent_stat_points > 0 || respecAvailable;

  const allocateContent = hasAnythingToDo ? (
    <StatPlannerBody
      character={character}
      equipmentBonuses={equipmentBonuses}
      onCommit={onBatchAllocateStats}
      layout="split"
      respecAvailable={respecAvailable}
      respecPoints={character.respec_points || 0}
      onRequestRespec={() => { void submit('respec'); }}
    />
  ) : (
    <ServicePanelEmpty>
      <p className="font-display text-foreground mb-1">The trainer studies your form.</p>
      <p>"You've nothing to refine just yet, wayfarer. Slay foes, gain levels, then return — and we'll forge raw experience into might."</p>
    </ServicePanelEmpty>
  );

  const renownContent = <div className="gap-group">
    <p>Progression commands are paused pending authority release.</p>
    <p>Renown balance: {character.bhp ?? 0} RP. Training requires level 30.</p>
    <p>Training ranks: {(['str','dex','con','int','wis','cha'] as const).map(stat => {
      const ranks = character.bhp_trained as Record<string, unknown> | null;
      return `${stat.toUpperCase()} ${typeof ranks?.[stat] === 'number' ? ranks[stat] : 0}`;
    }).join(' · ')}</p>
    <label htmlFor="renown-stat">Stat to train</label>
    <select id="renown-stat" value={selectedStat} disabled={submitting || !!(pending && 'stat' in pending)}
      onChange={event => setSelectedStat(event.target.value as ProgressionStat)}>
      {(['str','dex','con','int','wis','cha'] as const).map(stat => <option key={stat} value={stat}>{stat.toUpperCase()}</option>)}
    </select>
    <p>The server determines cost, chance and outcome. Failure spends RP.</p>
    <Button disabled={submitting} onClick={() => { void submit('renown'); }}>Submit Renown training</Button>
  </div>;

  // ── Leaderboard tab ──
  const renderLeaderRow = (row: LeaderRow, rank: number) => {
    const isMe = row.id === character.id;
    return (
      <div
        key={`${rank}-${row.id}`}
        className={`grid grid-cols-[36px_1fr_auto] gap-2 items-center p-1.5 rounded border ${
          isMe ? 'border-primary bg-primary/10' : 'surface-row'
        }`}
      >
        <span className={`font-display text-xs text-center tabular-nums ${rank <= 3 ? 'text-primary text-glow' : 'text-muted-foreground'}`}>
          #{rank}
        </span>
        <div className="min-w-0">
          <div className={`font-display text-sm truncate ${isMe ? 'text-primary' : 'text-foreground'}`}>
            {row.name}
          </div>
          <div className="text-[10px] text-muted-foreground capitalize">
            Lv{row.level} {row.class}
          </div>
        </div>
        <span className="font-display text-xs text-dwarvish tabular-nums whitespace-nowrap">
          {row.rp_total_earned.toLocaleString()} RP
        </span>
      </div>
    );
  };

  const leaderboardContent = (
    <div className="gap-group">
      <div className="grid grid-cols-[36px_1fr_auto] gap-2 px-1 text-[10px] font-display text-muted-foreground">
        <span className="text-center">Rank</span>
        <span>Wayfarer</span>
        <span className="text-right">Lifetime Renown</span>
      </div>

      {loadingBoard && (
        <p className="text-xs text-muted-foreground italic animate-pulse text-center py-4">
          Consulting the chronicles...
        </p>
      )}

      {!loadingBoard && leaders && leaders.length === 0 && (
        <ServicePanelEmpty>
          No wayfarer has yet earned Renown. The chronicles await.
        </ServicePanelEmpty>
      )}

      {!loadingBoard && leaders && leaders.length > 0 && (
        <div className="gap-row">
          {leaders.map((row, idx) => renderLeaderRow(row, idx + 1))}
        </div>
      )}

      {!loadingBoard && myRank !== null && (
        <div className="pt-2 mt-2 border-t border-border-subtle gap-row">
          <p className="text-[10px] text-muted-foreground text-center font-display">— Your Rank —</p>
          {renderLeaderRow(
            {
              id: character.id,
              name: character.name,
              level: character.level,
              class: String((character as any).class),
              rp_total_earned: character.rp_total_earned || 0,
            },
            myRank,
          )}
        </div>
      )}
    </div>
  );

  // ── Subtitle ──
  const subtitle = npcName ? (
    <>
      <span className="font-display text-primary">{npcName}</span>
      {npcFlavor && (
        <span className="block italic text-[11px] mt-0.5">"{npcFlavor}"</span>
      )}
    </>
  ) : (
    <span className="italic">Allocate your earned growth.</span>
  );

  const tabContent =
    tab === 'allocate' ? allocateContent
    : tab === 'renown' ? renownContent
    : leaderboardContent;

  return (
    <>
      <ServicePanelShell
        open={open}
        onClose={onClose}
        title="Trainer"
        subtitle={subtitle}
        tabs={tabsRow}
        singleColumn
        left={tabContent}
        miniLog={miniLog}
      />


      <p className="text-xs text-muted-foreground text-center">Commands are paused. Respec refunds only proven discretionary investment.</p>
    </>
  );
}
