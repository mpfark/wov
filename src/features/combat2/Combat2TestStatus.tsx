import type { Combat2StatusPresentation } from './presentation-selectors';

export function Combat2TestStatus({ presentation, diagnostic, onRetry, isTestArena = false }: { presentation: Combat2StatusPresentation; diagnostic?: string | null; onRetry?:()=>void; isTestArena?: boolean }) {
  return <aside aria-label={isTestArena ? 'Combat2 Test Arena status' : 'Combat2 status'} role="status" className="border border-border p-2 text-sm">
    <strong>Combat2: {presentation.label}</strong>
    {presentation.stale && <span> — Last confirmed state shown.</span>}
    <p>{presentation.guidance}</p>
    {diagnostic && <p role="alert">{diagnostic}</p>}
    {onRetry && <button type="button" className="underline" onClick={onRetry}>Retry combat access check</button>}
  </aside>;
}
