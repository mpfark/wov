import { ReactNode } from 'react';

interface AdminToolSectionProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Grouped section inside an AdminPageShell tool column.
 * Use one per logical group: Search, Filters, Actions, etc.
 */
export default function AdminToolSection({
  title,
  children,
  className = '',
}: AdminToolSectionProps) {
  return (
    <div className={`px-3 py-2.5 border-b border-border/60 last:border-b-0 ${className}`}>
      {title && (
        <p className="t-label text-[10px] mb-2">
          {title}
        </p>
      )}
      <div className="gap-row">{children}</div>
    </div>
  );
}
