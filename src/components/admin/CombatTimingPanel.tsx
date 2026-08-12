/**
 * CombatTimingPanel — development-only combat responsiveness breakdown.
 *
 * Replaces the console-only timing logs with a rolling view of where combat
 * time actually goes: button → submission, cadence gap, server round-trip,
 * apply, and paint. Each row is labelled so a clump of events can be read as
 * legitimate catch-up (ticks > 1) rather than assumed to be lag.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Timer, X, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

import {
  subscribeCombatTrace,
  getCombatTraceSamples,
  getCombatTraceSummary,
  clearCombatTrace,
  isCombatTraceEnabled,
  type CombatTraceSample,
  type TraceMetric,
} from '@/features/combat/trace/combat-trace';

function useTraceVersion() {
  const [, force] = useState(0);
  useEffect(() => subscribeCombatTrace(() => force(v => v + 1)), []);
}

function fmt(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  return `${Math.round(ms)}`;
}

function MetricRow({ label, m, warnAt }: { label: string; m: TraceMetric; warnAt: number }) {
  const hot = (m.p95 ?? 0) >= warnAt;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={hot ? 'text-destructive' : 'text-foreground'}>
        {fmt(m.p50)} / {fmt(m.p95)}
        <span className="text-muted-foreground"> ms</span>
      </span>
    </div>
  );
}

function SampleRow({ s }: { s: CombatTraceSample }) {
  const catchup = (s.ticksProcessed ?? 0) > 1;
  const discarded = s.outcome && s.outcome !== 'applied';
  return (
    <div
      className={`flex items-center gap-1.5 whitespace-nowrap ${
        discarded ? 'text-muted-foreground' : catchup ? 'text-amber-500' : 'text-foreground'
      }`}
      title={s.batchId ? `batch ${s.batchId}` : undefined}
    >
      <span className="w-10 shrink-0 text-muted-foreground">
        {s.seq ? `#${s.seq}` : 'bcast'}
      </span>
      <span className="w-14 shrink-0 text-muted-foreground">{s.cause}</span>
      <span className="w-12 shrink-0">gap {fmt(s.gapMs)}</span>
      <span className="w-12 shrink-0">rt {fmt(s.roundTripMs)}</span>
      <span className="w-12 shrink-0">ap {fmt(s.applyMs)}</span>
      <span className="w-12 shrink-0">pt {fmt(s.paintMs)}</span>
      {catchup && <span className="shrink-0">x{s.ticksProcessed} catch-up</span>}
      {discarded && <span className="shrink-0">{s.outcome}</span>}
      {s.abilityLabel && (
        <span className="shrink-0 text-primary">
          {s.abilityLabel} {fmt(s.buttonToSubmitMs)}ms
        </span>
      )}
    </div>
  );
}

export default function CombatTimingPanel() {
  useTraceVersion();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(true);

  if (!isCombatTraceEnabled()) return null;

  const summary = getCombatTraceSummary();
  const recent = getCombatTraceSamples().slice(-24).reverse();

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-3 right-28 z-[9999] flex items-center gap-1.5 rounded-full bg-background/90 border border-border px-3 py-1.5 text-xs font-mono text-muted-foreground shadow-lg backdrop-blur-sm hover:text-foreground transition-colors"
        title="Combat timing breakdown (dev)"
      >
        <Timer className="h-3 w-3 text-primary" />
        <span>{fmt(summary.roundTrip.p50)}ms</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-3 right-3 z-[9999] w-[30rem] max-h-[60vh] flex flex-col rounded-lg border border-border bg-background/95 backdrop-blur-sm shadow-xl font-mono text-[11px]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 text-foreground">
          <Timer className="h-3 w-3 text-primary" />
          <span className="font-semibold text-xs">Combat Timing</span>
          <span className="text-muted-foreground">n={summary.totalSamples}</span>
          <span className="text-amber-500">catch-up {summary.catchupCount}</span>
          <span className="text-muted-foreground">dropped {summary.discardedCount}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={clearCombatTrace} className="p-1 text-muted-foreground hover:text-foreground" title="Clear">
            <Trash2 className="h-3 w-3" />
          </button>
          <button onClick={() => setExpanded(!expanded)} className="p-1 text-muted-foreground hover:text-foreground">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
          </button>
          <button onClick={() => setOpen(false)} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 px-3 py-2 border-b border-border">
        <span className="col-span-2 text-muted-foreground">p50 / p95</span>
        <MetricRow label="button → submit" m={summary.buttonToSubmit} warnAt={600} />
        <MetricRow label="cadence gap" m={summary.cadenceGap} warnAt={3500} />
        <MetricRow label="round-trip" m={summary.roundTrip} warnAt={1200} />
        <MetricRow label="server resolve" m={summary.serverResolve} warnAt={900} />
        <MetricRow label="apply" m={summary.apply} warnAt={120} />
        <MetricRow label="paint" m={summary.paint} warnAt={120} />
      </div>

      {expanded && (
        <div className="flex-1 overflow-auto px-2 py-1 space-y-0.5">
          {recent.length === 0 && (
            <p className="text-muted-foreground text-center py-4">No combat ticks recorded yet…</p>
          )}
          {recent.map((s, i) => (
            <SampleRow key={`${s.seq}-${s.startedAt}-${i}`} s={s} />
          ))}
        </div>
      )}
    </div>
  );
}
