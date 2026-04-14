import { ReactNode } from 'react';

interface AdminEntityToolbarProps {
  icon: ReactNode;
  title: string;
  count?: number;
  children?: ReactNode;
}

export default function AdminEntityToolbar({ icon, title, count, children }: AdminEntityToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
      <span className="w-4 h-4 text-primary flex items-center justify-center">{icon}</span>
      <h2 className="font-display text-sm text-primary">{title}</h2>
      {count !== undefined && (
        <span className="text-xs text-muted-foreground">({count})</span>
      )}
      <div className="flex-1" />
      {children}
    </div>
  );
}
