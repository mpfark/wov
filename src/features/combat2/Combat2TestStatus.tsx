export function Combat2TestStatus({ status, stale, diagnostic }: { status: string; stale: boolean; diagnostic?: string | null }) {
  return <aside aria-label="Combat2 controlled test" role="status" className="border border-amber-500 p-2 text-sm">
    <strong>Combat2: {status}</strong>
    {stale && <span> — Stale display; actions disabled.</span>}
    <p>Movement and recovery are unavailable in this controlled solo test.</p>
    {diagnostic && <p role="alert">{diagnostic}</p>}
  </aside>;
}
