export function Combat2TestStatus({ status, stale, diagnostic, onRetry }: { status: string; stale: boolean; diagnostic?: string | null; onRetry?:()=>void }) {
  return <aside aria-label="Combat2 controlled test" role="status" className="border border-amber-500 p-2 text-sm">
    <strong>Combat2: {status}</strong>
    {stale && <span> — Stale display; actions disabled.</span>}
    <p>Movement and recovery are unavailable in this controlled solo test.</p>
    {diagnostic && <p role="alert">{diagnostic}</p>}
    {onRetry && <button type="button" className="underline" onClick={onRetry}>Retry arena access check</button>}
  </aside>;
}
