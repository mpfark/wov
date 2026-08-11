/**
 * Lightweight onboarding coachmark — finds a target by [data-onboarding="<id>"]
 * and renders a fixed-position callout pointing at it. Persists dismissal in
 * localStorage so each hint shows at most once per browser.
 */
import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

interface Props {
  /** Matches [data-onboarding="<targetId>"] on the element to highlight. */
  targetId: string;
  title: string;
  body: string;
  /** Delay before showing (ms) so the UI settles. */
  delayMs?: number;
  /** Optional: only show once this is true (e.g. character loaded). */
  enabled?: boolean;
  /**
   * Optional dismissal scope (e.g. a character id). When set, the hint is
   * dismissed per scope instead of globally per browser.
   */
  scopeId?: string;
}

const storageKey = (id: string, scopeId?: string) =>
  `onboarding.${id}${scopeId ? `.${scopeId}` : ''}.dismissed.v1`;

export function OnboardingCoachmark({ targetId, title, body, delayMs = 1200, enabled = true, scopeId }: Props) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(storageKey(targetId, scopeId)) === '1'; } catch { return true; }
  });

  // Re-evaluate dismissal when the scope changes (e.g. switching character).
  useEffect(() => {
    try { setDismissed(localStorage.getItem(storageKey(targetId, scopeId)) === '1'); } catch { setDismissed(true); }
  }, [targetId, scopeId]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try { localStorage.setItem(storageKey(targetId, scopeId), '1'); } catch { /* ignore */ }
  }, [targetId, scopeId]);


  // Locate the target element (poll briefly, then watch on resize/scroll).
  useEffect(() => {
    if (dismissed || !enabled) return;
    let cancelled = false;
    let raf = 0;
    let tries = 0;

    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-onboarding="${targetId}"]`);
      if (el) {
        setRect(el.getBoundingClientRect());
      }
    };

    const tick = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(`[data-onboarding="${targetId}"]`);
      if (el) {
        setRect(el.getBoundingClientRect());
        return;
      }
      tries += 1;
      if (tries < 40) raf = window.setTimeout(tick, 150) as unknown as number;
    };

    const startTimer = window.setTimeout(tick, delayMs);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);

    // Dismiss when the user actually clicks the target.
    const onDocClick = (e: MouseEvent) => {
      const el = document.querySelector<HTMLElement>(`[data-onboarding="${targetId}"]`);
      if (el && e.target instanceof Node && el.contains(e.target)) dismiss();
    };
    document.addEventListener('click', onDocClick, true);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      window.clearTimeout(raf);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      document.removeEventListener('click', onDocClick, true);
    };
  }, [targetId, delayMs, enabled, dismissed]);

  if (dismissed || !enabled || !rect) return null;

  // Position the callout below the target, clamped to viewport.
  const calloutW = 260;
  const margin = 8;
  const top = Math.min(rect.bottom + 10, window.innerHeight - 140);
  let left = rect.left + rect.width / 2 - calloutW / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - calloutW - margin));
  const arrowLeft = Math.max(12, Math.min(rect.left + rect.width / 2 - left, calloutW - 20));

  return createPortal(
    <>
      {/* Pulsing ring around the target */}
      <div
        className="pointer-events-none fixed z-[60] rounded-md animate-pulse"
        style={{
          top: rect.top - 4,
          left: rect.left - 4,
          width: rect.width + 8,
          height: rect.height + 8,
          boxShadow: '0 0 0 2px hsl(var(--primary)), 0 0 16px 4px hsl(var(--primary) / 0.5)',
        }}
      />
      {/* Callout */}
      <div
        className="fixed z-[61] surface-raised rounded-md p-3 shadow-lg border border-border"
        style={{ top, left, width: calloutW }}
        role="dialog"
        aria-label={title}
      >
        <div
          className="absolute -top-1.5 h-3 w-3 rotate-45 bg-card border-l border-t border-border"
          style={{ left: arrowLeft }}
        />
        <div className="flex items-start justify-between gap-2 mb-1">
          <span className="font-display text-sm text-primary">{title}</span>
          <button
            type="button"
            onClick={dismiss}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground leading-snug mb-2">{body}</p>
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={dismiss}>
            Got it
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}
