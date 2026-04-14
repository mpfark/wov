import { ReactNode } from 'react';

interface AdminEmptyStateProps {
  message: string;
  icon?: ReactNode;
}

export default function AdminEmptyState({ message, icon }: AdminEmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/50 text-sm italic font-display gap-2 py-8">
      {icon && <span className="text-2xl">{icon}</span>}
      {message}
    </div>
  );
}
