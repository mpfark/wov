import { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Save, X } from 'lucide-react';

interface AdminStickyActionsProps {
  onSave: () => void;
  onCancel: () => void;
  saveLabel?: string;
  loading?: boolean;
  extraActions?: ReactNode;
}

export default function AdminStickyActions({ onSave, onCancel, saveLabel = 'Save', loading, extraActions }: AdminStickyActionsProps) {
  return (
    <div className="flex gap-2 pt-2">
      <Button onClick={onSave} disabled={loading} className="font-display text-xs">
        <Save className="w-3 h-3 mr-1" /> {saveLabel}
      </Button>
      <Button variant="outline" onClick={onCancel} className="font-display text-xs">
        <X className="w-3 h-3 mr-1" /> Cancel
      </Button>
      {extraActions}
    </div>
  );
}
