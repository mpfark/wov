export function Combat2TestStatus({ status, stale, locked = true, diagnostic, onRetry }: { status: string; stale: boolean; locked?: boolean; diagnostic?: string | null; onRetry?:()=>void }) {
  return <aside aria-label="Combat2 controlled test" role="status" className="border border-amber-500 p-2 text-sm">
    <strong>Combat2: {status}</strong>
    {stale && <span> — Stale display; actions disabled.</span>}
    {locked
      ? <p>Movement and combat actions are unavailable while the session is locked.</p>
      : <p>Movement and combat actions are available.</p>}
    {diagnostic && <p role="alert">{diagnostic}</p>}
    {onRetry && <button type="button" className="underline" onClick={onRetry}>Retry arena access check</button>}
  </aside>;
}
