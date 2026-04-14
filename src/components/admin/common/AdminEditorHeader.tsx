import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

interface AdminEditorHeaderProps {
  title: string;
  onClose: () => void;
}

export default function AdminEditorHeader({ title, onClose }: AdminEditorHeaderProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
      <h2 className="font-display text-sm text-primary text-glow truncate">{title}</h2>
      <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0">
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}
