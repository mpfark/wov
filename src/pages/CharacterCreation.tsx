import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  RACE_LABELS, CLASS_LABELS, RACE_DESCRIPTIONS, CLASS_DESCRIPTIONS,
  STAT_LABELS, RACE_STATS, CLASS_STATS, CLASS_BASE_HP, CLASS_BASE_AC,
  calculateStats, calculateHP, calculateAC, getMaxCp,
} from '@/lib/game-data';

interface Props {
  onCreateCharacter: (data: any) => Promise<any>;
  onCharacterReady?: (id: string) => void;
  startingNodeId: string;
  onBack?: () => void;
}

export default function CharacterCreation({ onCreateCharacter, onCharacterReady, startingNodeId, onBack }: Props) {
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | ''>('');
  const [race, setRace] = useState('');
  const [charClass, setCharClass] = useState('');
  const [step, setStep] = useState(0); // 0=name, 1=gender, 2=race, 3=class, 4=confirm
  const [loading, setLoading] = useState(false);

  const stats = race && charClass ? calculateStats(race, charClass) : null;
  const hp = stats && charClass ? calculateHP(charClass, stats.con) : 0;
  const ac = stats && charClass ? calculateAC(charClass, stats.dex) : 0;

  const handleCreate = async () => {
    if (!stats) return;
    setLoading(true);
    try {
      const maxCp = getMaxCp(1, stats.int, stats.wis, stats.cha);
      const char = await onCreateCharacter({
        name, gender, race, class: charClass,
        ...stats, hp, max_hp: hp, ac,
        current_node_id: startingNodeId,
        cp: maxCp, max_cp: maxCp,
      });
      // Grant starting gear via server-side RPC (handles class + universal gear atomically)
      if (char?.id) {
        await supabase.rpc('grant_starting_gear' as any, { p_character_id: char.id });
        onCharacterReady?.(char.id);
      }
      toast.success(`${name} has begun their adventure!`);
    } catch (err: any) {
      if (err.message?.includes('characters_name_unique') || err.code === '23505') {
        toast.error(`The name "${name}" is already taken. Choose a different name.`);
        setStep(0);
      } else {
        toast.error(err.message || 'Failed to create character');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center parchment-bg p-4">
      <Card className="w-full max-w-lg ornate-border bg-card/90 backdrop-blur">
        <CardHeader className="text-center">
          {onBack && (
            <div className="flex justify-start">
              <Button variant="ghost" size="sm" onClick={onBack} className="text-xs font-display text-muted-foreground">
                ← Back to Characters
              </Button>
            </div>
          )}
          <h1 className="font-display text-2xl text-primary text-glow">Forge Your Hero</h1>
          <p className="text-sm text-muted-foreground">Step {step + 1} of 5</p>
        </CardHeader>
        <CardContent>
          {step === 0 && (
            <div className="space-y-4">
              <CardTitle className="font-display text-lg">Name Your Character</CardTitle>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Theron, Mirael, Dunric..."
                className="bg-input border-border text-lg"
                maxLength={24}
              />
              <Button onClick={() => setStep(1)} disabled={!name.trim()} className="w-full font-display">
                Continue
              </Button>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <CardTitle className="font-display text-lg">Choose Gender</CardTitle>
              <div className="grid grid-cols-2 gap-3">
                {(['male', 'female'] as const).map(g => (
                  <button
                    key={g}
                    onClick={() => { setGender(g); setStep(2); }}
                    className={`p-4 rounded-md border text-center transition-all hover:border-primary ${
                      gender === g ? 'border-primary bg-primary/10' : 'border-border bg-card'
                    }`}
                  >
                    <div className="text-2xl mb-1">{g === 'male' ? '♂' : '♀'}</div>
                    <div className="font-display text-sm text-foreground capitalize">{g}</div>
                  </button>
                ))}
              </div>
              <Button variant="ghost" onClick={() => setStep(0)} className="font-display">Back</Button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <CardTitle className="font-display text-lg">Choose Your Race</CardTitle>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(RACE_LABELS).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => { setRace(key); setStep(3); }}
                    className={`p-3 rounded-md border text-left transition-all hover:border-primary ${
                      race === key ? 'border-primary bg-primary/10' : 'border-border bg-card'
                    }`}
                  >
                    <div className="font-display text-sm text-foreground">{label}</div>
                    <div className="text-xs text-muted-foreground mt-1">{RACE_DESCRIPTIONS[key]}</div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {Object.entries(RACE_STATS[key] || {}).filter(([, v]) => v !== 0).map(([stat, val]) => (
                        <span key={stat} className={`text-[10px] px-1.5 py-0.5 rounded font-display ${
                          (val as number) > 0 ? 'bg-primary/15 text-primary' : 'bg-destructive/15 text-destructive'
                        }`}>
                          {(val as number) > 0 ? '+' : ''}{val as number} {STAT_LABELS[stat]}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
              <Button variant="ghost" onClick={() => setStep(1)} className="font-display">Back</Button>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <CardTitle className="font-display text-lg">Choose Your Class</CardTitle>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(CLASS_LABELS).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => { setCharClass(key); setStep(4); }}
                    className={`p-3 rounded-md border text-left transition-all hover:border-primary ${
                      charClass === key ? 'border-primary bg-primary/10' : 'border-border bg-card'
                    }`}
                  >
                    <div className="font-display text-sm text-foreground">{label}</div>
                    <div className="text-xs text-muted-foreground mt-1">{CLASS_DESCRIPTIONS[key]}</div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {Object.entries(CLASS_STATS[key] || {}).filter(([, v]) => v !== 0).map(([stat, val]) => (
                        <span key={stat} className={`text-[10px] px-1.5 py-0.5 rounded font-display ${
                          (val as number) > 0 ? 'bg-primary/15 text-primary' : 'bg-destructive/15 text-destructive'
                        }`}>
                          {(val as number) > 0 ? '+' : ''}{val as number} {STAT_LABELS[stat]}
                        </span>
                      ))}
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-display bg-destructive/15 text-blood">
                        HP {CLASS_BASE_HP[key]}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-display bg-muted text-muted-foreground">
                        AC {CLASS_BASE_AC[key]}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              <Button variant="ghost" onClick={() => setStep(2)} className="font-display">Back</Button>
            </div>
          )}

          {step === 4 && stats && (
            <div className="space-y-4">
              <CardTitle className="font-display text-lg">Confirm Your Hero</CardTitle>
              <div className="ornate-border p-4 rounded-md bg-background/50">
                <h3 className="font-display text-primary text-glow text-xl">{name}</h3>
                <p className="text-sm text-muted-foreground">
                  <span className="capitalize">{gender}</span> {RACE_LABELS[race]} {CLASS_LABELS[charClass]}
                </p>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {Object.entries(STAT_LABELS).map(([key, label]) => (
                    <div key={key} className="text-center p-2 bg-card rounded border border-border">
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <div className="text-lg font-display text-foreground">{stats[key]}</div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-4 mt-3 text-sm">
                  <span className="text-blood">HP: {hp}</span>
                  <span className="text-muted-foreground">AC: {ac}</span>
                  <span className="text-primary">Gold: 10</span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep(3)} className="font-display">Back</Button>
                <Button onClick={handleCreate} disabled={loading} className="flex-1 font-display">
                  {loading ? 'Creating...' : 'Begin Your Adventure'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
