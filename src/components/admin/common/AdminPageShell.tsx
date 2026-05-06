import { ReactNode } from 'react';

interface AdminPageShellProps {
  /** Optional icon shown next to the title in the tool column header. */
  icon?: ReactNode;
  /** Page title shown at the top of the tool column. */
  title?: string;
  /** Optional count badge displayed next to the title. */
  count?: number;
  /** Content for the left tool column: filters, search, page actions. */
  tools: ReactNode;
  /** Main content pane (list, editor, map, etc.). */
  children: ReactNode;
  /** Optional override for the tool column width. */
  toolWidth?: string;
}

/**
 * Standard admin page layout: a fixed-width tool column on the left
 * and a flexible main content pane on the right.
 *
 *  ┌───────────────┬────────────────────────────────────┐
 *  │ Tool column   │ Main pane                          │
 *  │ (filters,     │ (list / grid / editor / map)       │
 *  │  actions)     │                                    │
 *  └───────────────┴────────────────────────────────────┘
 */
export default function AdminPageShell({
  icon,
  title,
  count,
  tools,
  children,
  toolWidth = 'w-[240px]',
}: AdminPageShellProps) {
  return (
    <div className="flex h-full min-h-0 w-full">
      <aside
        className={`${toolWidth} shrink-0 border-r border-border bg-card/30 flex flex-col min-h-0`}
      >
        {(title || icon) && (
          <div className="flex items-center gap-2 px-3 py-3 border-b border-border shrink-0">
            {icon && (
              <span className="w-4 h-4 text-primary flex items-center justify-center">
                {icon}
              </span>
            )}
            {title && (
              <h2 className="font-display text-sm text-primary truncate">{title}</h2>
            )}
            {count !== undefined && (
              <span className="text-xs text-muted-foreground">({count})</span>
            )}
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto">{tools}</div>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">{children}</div>
    </div>
  );
}
