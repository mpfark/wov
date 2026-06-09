/**
 * SoulforgeDialog — wraps the same `useSoulforgeForge` hook used inside the
 * Blacksmith panel, but in a focused dialog reached by talking to "The
 * Soulwright" NPC.
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Character } from '@/features/character';
import { useSoulforgeForge } from './SoulforgeTabContent';

interface Props {
  open: boolean;
  onClose: () => void;
  character: Character;
  onForged: () => void;
}

export default function SoulforgeDialog({ open, onClose, character, onForged }: Props) {
  const slots = useSoulforgeForge({
    character,
    onForged: () => { onForged(); /* keep dialog open so the player sees the new ring */ },
  });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl border-soulforged/30 bg-card max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-soulforged text-glow-soulforged flex items-center gap-2">
            💍 The Soulwright
          </DialogTitle>
          <DialogDescription className="text-xs italic text-muted-foreground">
            An ancient artisan wreathed in spectral flame.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            {slots.leftTitle && (
              <p className="text-xs font-display text-muted-foreground mb-1">{slots.leftTitle}</p>
            )}
            {slots.left}
          </div>
          <div>
            {slots.rightTitle && (
              <p className="text-xs font-display text-muted-foreground mb-1">{slots.rightTitle}</p>
            )}
            {slots.right}
          </div>
        </div>

        {slots.footer && <div className="mt-2">{slots.footer}</div>}
      </DialogContent>
    </Dialog>
  );
}
