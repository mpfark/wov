import { OnlinePlayer } from '@/hooks/useGlobalPresence';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Users } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getCharacterTitle } from '@/lib/game-data';

const RACE_LABELS: Record<string, string> = {
  human: 'Human', elf: 'Elf', dwarf: 'Dwarf', halfling: 'Halfling', edain: 'Edain', half_elf: 'Half-Elf',
};
const CLASS_LABELS: Record<string, string> = {
  warrior: 'Warrior', wizard: 'Wizard', ranger: 'Ranger', rogue: 'Rogue', healer: 'Healer', bard: 'Bard',
};

interface Props {
  onlinePlayers: OnlinePlayer[];
  myCharacterId?: string;
}

export default function OnlinePlayersDialog({ onlinePlayers, myCharacterId }: Props) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-xs font-display gap-1.5">
          <Users className="h-3.5 w-3.5" />
          <span>{onlinePlayers.length} Online</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Adventurers Online
            <Badge variant="secondary" className="ml-auto text-xs">{onlinePlayers.length}</Badge>
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          {onlinePlayers.length === 0 ? (
            <p className="text-sm text-muted-foreground italic text-center py-6">No adventurers found...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Race</TableHead>
                  <TableHead className="text-xs">Class</TableHead>
                  <TableHead className="text-xs text-right">Level</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {onlinePlayers.map(p => (
                  <TableRow key={p.id} className={p.id === myCharacterId ? 'bg-primary/5' : ''}>
                    <TableCell className="text-xs font-display">
                      <div>
                        {getCharacterTitle(p.level, p.gender) && (
                          <span className="text-[9px] text-primary/70 tracking-widest uppercase mr-1">{getCharacterTitle(p.level, p.gender)}</span>
                        )}
                        {p.name}
                        {p.id === myCharacterId && <span className="text-muted-foreground ml-1">(you)</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{RACE_LABELS[p.race] || p.race}</TableCell>
                    <TableCell className="text-xs">{CLASS_LABELS[p.class] || p.class}</TableCell>
                    <TableCell className="text-xs text-right font-display">{p.level}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
