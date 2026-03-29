import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Character } from '@/hooks/useCharacter';
import { RACE_LABELS, CLASS_LABELS } from '@/lib/game-data';
import { Trash2, Plus, Swords, UserCircle } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  characters: Character[];
  onSelect: (id: string) => void;
  onCreateNew: () => void;
  onDelete: (id: string) => Promise<void>;
  onSignOut: () => void;
  onProfile?: () => void;
}

export default function CharacterSelect({ characters, onSelect, onCreateNew, onDelete, onSignOut, onProfile }: Props) {
  const [deleteTarget, setDeleteTarget] = useState<Character | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await onDelete(deleteTarget.id);
      toast.success(`${deleteTarget.name} has been deleted.`);
    } catch {
      toast.error('Failed to delete character.');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center parchment-bg p-4">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center space-y-1">
          <h1 className="font-display text-3xl text-primary text-glow">Choose Your Hero</h1>
          <p className="text-sm text-muted-foreground">Select a character or forge a new one</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[...characters].sort((a, b) => a.name.localeCompare(b.name)).map(char => (
            <Card
              key={char.id}
              className="ornate-border bg-card/90 backdrop-blur cursor-pointer transition-all hover:border-primary hover:shadow-lg hover:shadow-primary/10 group"
              onClick={() => onSelect(char.id)}
            >
              <CardHeader className="pb-2 flex flex-row items-start justify-between">
                <div>
                  <h3 className="font-display text-lg text-primary group-hover:text-glow">{char.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {RACE_LABELS[char.race] || char.race} {CLASS_LABELS[char.class] || char.class}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(char); }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center gap-4 text-sm">
                  <span className="font-display text-foreground">Lvl {char.level}</span>
                  <span className="text-blood">HP {char.hp}/{char.max_hp}</span>
                  <span className="text-primary">Gold {char.gold}</span>
                </div>
              </CardContent>
            </Card>
          ))}

          {/* Create New Card */}
          <Card
            className="ornate-border bg-card/60 backdrop-blur cursor-pointer transition-all hover:border-primary hover:shadow-lg hover:shadow-primary/10 flex items-center justify-center min-h-[120px]"
            onClick={onCreateNew}
          >
            <div className="text-center space-y-2 py-4">
              <Plus className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="font-display text-sm text-muted-foreground">Create New Character</p>
            </div>
          </Card>
        </div>

        <div className="text-center flex items-center justify-center gap-3">
          {onProfile && (
            <Button variant="ghost" size="sm" onClick={onProfile} className="text-xs text-muted-foreground">
              <UserCircle className="h-3.5 w-3.5 mr-1" /> Profile
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onSignOut} className="text-xs text-muted-foreground">
            Sign Out
          </Button>
        </div>
      </div>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="ornate-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this character, their inventory, and party memberships. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? 'Deleting...' : 'Delete Forever'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
