import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { NPC } from '@/features/creatures';

interface Props {
  npc: NPC | null;
  open: boolean;
  onClose: () => void;
}

export default function NPCDialogPanel({ npc, open, onClose }: Props) {
  if (!npc) return null;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md border-primary/30 bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-primary text-glow flex items-center gap-2">
            💬 {npc.name}
          </DialogTitle>
          {npc.description && (
            <DialogDescription className="text-xs italic">{npc.description}</DialogDescription>
          )}
        </DialogHeader>
        <div className="p-3 bg-background/50 rounded border border-border">
          <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
            {npc.dialogue || '...'}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
