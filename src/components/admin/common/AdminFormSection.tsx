import { ReactNode } from 'react';

interface AdminFormSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export default function AdminFormSection({ title, description, children }: AdminFormSectionProps) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-xs font-display text-muted-foreground uppercase tracking-wide">{title}</h3>
        {description && <p className="text-[10px] text-muted-foreground/70">{description}</p>}
      </div>
      {children}
    </div>
  );
}
