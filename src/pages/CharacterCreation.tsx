import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { toast } from 'sonner';
import { RACE_LABELS, RACE_DESCRIPTIONS } from '@/lib/game-data';
import { creationManifest, creationCapacity, pendingCreation, type CreationChoices } from '@/features/character/creation-client';

interface Props {
  actorId: string;
  targetAccount?: string;
  onCreateCharacter: (choices: CreationChoices) => Promise<{ id: string } | null>;
  onCharacterReady?: (id: string) => void;
  onBack?: () => void;
}
export default function CharacterCreation({ actorId, targetAccount, onCreateCharacter, onCharacterReady, onBack }: Props) {
  const [initial] = useState(() => pendingCreation(actorId, targetAccount));
  const [name, setName] = useState(initial?.choices.name ?? '');
  const [race, setRace] = useState(initial?.choices.race ?? '');
  const [gender, setGender] = useState<'male' | 'female'>(initial?.choices.gender ?? 'male');
  const [reason, setReason] = useState(initial?.choices.reason ?? '');
  const [loading, setLoading] = useState(false);
  const [capacity, setCapacity] = useState<{ retained: number; limit: number } | null>(null);
  const [capacityError, setCapacityError] = useState('');
  const [pending, setPending] = useState(!!initial);
  useEffect(() => {
    let active = true;
    creationCapacity(targetAccount).then(value => { if (active) setCapacity(value); })
      .catch(error => { if (active) setCapacityError(error.message); });
    return () => { active = false; };
  }, [actorId, targetAccount]);
  const create = async () => {
    setLoading(true);
    try {
      const character = await onCreateCharacter({ name, race, gender,
        ...(targetAccount ? { targetAccount, reason } : {}) });
      if (!character?.id) throw new Error('Creation did not return an available character.');
      setPending(false);
      toast.success(`${name.trim()} begins as a Wayfarer.`);
      onCharacterReady?.(character.id);
    } catch (error: unknown) {
      setPending(!!pendingCreation(actorId, targetAccount));
      toast.error(error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error));
    } finally { setLoading(false); }
  };
  const locked = loading || pending;
  return <div className="flex min-h-screen items-start justify-center parchment-bg p-4 py-8">
    <Card className="w-full max-w-4xl ornate-border bg-card/90">
      <CardHeader>
        {onBack && <Button variant="ghost" onClick={onBack} disabled={loading}>Back</Button>}
        <h1 className="font-display text-2xl text-primary">Begin Your Adventure</h1>
        <p>Choose your name, gender and race. Your character starts as a classless Wayfarer.</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <label className="block">Name<Input aria-label="Name" value={name} disabled={locked}
          maxLength={creationManifest.creation.nameMaxLength} onChange={e => setName(e.target.value)} /></label>
        <label className="block">Gender<select aria-label="Gender" value={gender} disabled={locked}
          onChange={e => setGender(e.target.value as 'male' | 'female')}>
          <option value="male">Male</option><option value="female">Female</option></select></label>
        <div className="grid grid-cols-2 gap-2">
          {Object.keys(creationManifest.races).map(key => <Button key={key} disabled={locked}
            variant={race === key ? 'default' : 'outline'} onClick={() => setRace(key)}>
            {RACE_LABELS[key] ?? key}</Button>)}
        </div>
        {race && <p>{RACE_DESCRIPTIONS[race]}</p>}
        <p>Level 1, 200 gold, 40 salvage and one of each of the six starting gems.
          No equipment, inventory items or family assignment. Attributes and resources are calculated by the server.</p>
        {targetAccount && <label className="block">Delegation reason<Input aria-label="Delegation reason"
          value={reason} disabled={locked} maxLength={2000} onChange={e => setReason(e.target.value)} /></label>}
        <p>{capacity ? `${capacity.retained} of ${capacity.limit} account slots occupied, including deleted characters.` :
          capacityError || 'Checking account slots…'}</p>
        {pending && <p>A creation is awaiting confirmation. Retry its original choices safely.</p>}
        <Button onClick={create} disabled={loading || !name.trim() || !race || (targetAccount && !reason.trim())
          || (!pending && (!capacity || capacity.retained >= capacity.limit))}>
          {loading ? 'Confirming…' : pending ? 'Retry creation' : 'Create Wayfarer'}</Button>
      </CardContent>
    </Card>
  </div>;
}
