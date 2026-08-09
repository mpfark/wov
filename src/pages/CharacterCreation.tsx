import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Dices, Loader2 } from 'lucide-react';
import {
  RACE_LABELS, RACE_DESCRIPTIONS, STAT_LABELS, RACE_STATS,
  calculateStats, calculateAC, getMaxCp, getMaxHp,
  getSelectableRaceKeys,
} from '@/lib/game-data';
import { useRaceRegistry } from '@/hooks/useRaceRegistry';

interface Props {
  onCreateCharacter: (data: any) => Promise<any>;
  onCharacterReady?: (id: string) => void;
  startingNodeId: string;
  onBack?: () => void;
}

const STARTING_CLASS = 'classless';

export default function CharacterCreation({ onCreateCharacter, onCharacterReady, startingNodeId, onBack }: Props) {
  const [name, setName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [familyStatus, setFamilyStatus] = useState<{
    status: 'available' | 'founder' | 'member' | 'needs_request' | 'request_pending' | 'reserved' | 'invalid';
    founder_display_name?: string;
  } | null>(null);
  const [familyChecking, setFamilyChecking] = useState(false);
  const [gender, setGender] = useState<'male' | 'female' | ''>('');
  const [race, setRace] = useState('');
  const [hoverRace, setHoverRace] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rolling, setRolling] = useState(false);

  const effectiveRace = hoverRace ?? race;
  const previewStats = effectiveRace ? calculateStats(effectiveRace, STARTING_CLASS) : null;
  const previewHp = previewStats ? getMaxHp(STARTING_CLASS, previewStats.con, 1) : 0;
  const previewAc = previewStats ? calculateAC(STARTING_CLASS, previewStats.dex) : 0;

  const stats = race ? calculateStats(race, STARTING_CLASS) : null;
  const familyOk = !familyName.trim()
    || (familyStatus && ['available', 'founder', 'member'].includes(familyStatus.status));
  const canCreate = !!(name.trim() && gender && race && stats && familyOk && !familyChecking);

  const handleReroll = async () => {
    setRolling(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-suggest-character-name', {
        body: { race: race || undefined, gender: gender || undefined },
      });
      if (error) throw error;
      if (data?.name) setName(data.name);
      else toast.error('No name returned, try again.');
    } catch (err: any) {
      const msg = err?.context?.error || err?.message || 'Failed to suggest a name';
      toast.error(msg);
    } finally {
      setRolling(false);
    }
  };

  const checkFamily = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) { setFamilyStatus(null); return; }
    if (!/^[A-Za-z]{2,20}$/.test(trimmed)) {
      setFamilyStatus({ status: 'invalid' });
      return;
    }
    setFamilyChecking(true);
    try {
      const { data, error } = await supabase.rpc('check_family_name', { _display: trimmed });
      if (error) throw error;
      setFamilyStatus(data as any);
    } catch (err: any) {
      console.warn('check_family_name failed', err);
      setFamilyStatus(null);
    } finally {
      setFamilyChecking(false);
    }
  };

  const handleRequestJoin = async () => {
    try {
      const { error } = await supabase.rpc('request_family_membership', { _display: familyName.trim() });
      if (error) throw error;
      toast.success(`Request sent to the ${familyName.trim()} founder.`);
      setFamilyStatus(prev => prev ? { ...prev, status: 'request_pending' } : prev);
    } catch (err: any) {
      toast.error(err.message || 'Could not send request');
    }
  };

  const handleCreate = async () => {
    if (!stats) return;
    setLoading(true);
    try {
      const maxCp = getMaxCp(1, stats.wis);
      const hp = getMaxHp(STARTING_CLASS, stats.con, 1);
      const ac = calculateAC(STARTING_CLASS, stats.dex);
      const char = await onCreateCharacter({
        name, gender, race, class: STARTING_CLASS,
        ...stats, hp, max_hp: hp, ac,
        current_node_id: startingNodeId,
        cp: maxCp, max_cp: maxCp,
        is_classless: true,
      });
      if (char?.id) {
        const family = familyName.trim();
        if (family) {
          const { error: famErr } = await supabase.rpc('apply_family_to_character', {
            _character_id: char.id, _display: family,
          });
          if (famErr) toast.error(famErr.message || 'Family name could not be applied');
        }
        onCharacterReady?.(char.id);
      }
      toast.success(`${name}${familyName.trim() ? ' ' + familyName.trim() : ''} sets out into the world as a Wayfarer.`);
    } catch (err: any) {
      if (err.message?.includes('characters_name_unique') || err.code === '23505') {
        toast.error(`The name "${name}" is already taken. Choose a different name.`);
      } else {
        toast.error(err.message || 'Failed to create character');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-start justify-center parchment-bg p-4 py-8">
      <Card className="w-full max-w-4xl ornate-border bg-card/90 backdrop-blur">
        <CardHeader className="text-center pb-4">
          {onBack && (
            <div className="flex justify-start">
              <Button variant="ghost" size="sm" onClick={onBack} className="text-xs font-display text-muted-foreground">
                ← Back to Characters
              </Button>
            </div>
          )}
          <h1 className="font-display text-2xl text-primary text-glow">Begin Your Adventure</h1>
          <p className="text-sm text-muted-foreground">
            Choose name, gender and race — your <span className="text-primary">order</span> awaits you in the world.
          </p>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Name + Gender row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="font-display text-sm text-foreground">Name</label>
              <div className="flex gap-2">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value.replace(/\s/g, ''))}
                  placeholder="Theron, Mirael, Dunric..."
                  className="bg-input border-border text-base"
                  maxLength={24}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleReroll}
                  disabled={rolling}
                  title="Suggest a fantasy name"
                  className="shrink-0"
                >
                  {rolling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Dices className="h-4 w-4" />}
                </Button>
              </div>
              <div className="space-y-1">
                <Input
                  value={familyName}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^A-Za-z]/g, '').slice(0, 20);
                    setFamilyName(v);
                    setFamilyStatus(null);
                  }}
                  onBlur={(e) => checkFamily(e.target.value)}
                  placeholder="Family name (optional, e.g. Stormwind)"
                  className="bg-input border-border text-sm"
                  maxLength={20}
                />
                {familyName && (
                  <div className="text-[11px] leading-tight min-h-[16px]">
                    {familyChecking && <span className="text-muted-foreground italic">Checking…</span>}
                    {!familyChecking && familyStatus?.status === 'invalid' && (
                      <span className="text-destructive">Letters only, 2–20 characters.</span>
                    )}
                    {!familyChecking && familyStatus?.status === 'reserved' && (
                      <span className="text-destructive">That name is reserved.</span>
                    )}
                    {!familyChecking && familyStatus?.status === 'available' && (
                      <span className="text-elvish">Available — you'll found this family.</span>
                    )}
                    {!familyChecking && familyStatus?.status === 'founder' && (
                      <span className="text-primary">Your family.</span>
                    )}
                    {!familyChecking && familyStatus?.status === 'member' && (
                      <span className="text-primary">Member — you may use this.</span>
                    )}
                    {!familyChecking && familyStatus?.status === 'needs_request' && (
                      <span className="text-muted-foreground">
                        Founded by <span className="text-primary">{familyStatus.founder_display_name}</span>.{' '}
                        <button type="button" onClick={handleRequestJoin} className="underline text-primary hover:text-primary/80">
                          Request to join
                        </button>
                      </span>
                    )}
                    {!familyChecking && familyStatus?.status === 'request_pending' && (
                      <span className="text-muted-foreground italic">Request pending founder's approval.</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="font-display text-sm text-foreground">Gender</label>
              <div className="grid grid-cols-2 gap-2">
                {(['male', 'female'] as const).map(g => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGender(g)}
                    className={`p-3 rounded-md border text-center transition-all hover:border-primary ${
                      gender === g ? 'border-primary bg-primary/10' : 'border-border bg-card'
                    }`}
                  >
                    <span className="text-xl mr-2">{g === 'male' ? '♂' : '♀'}</span>
                    <span className="font-display text-sm capitalize">{g}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Race grid */}
          <div className="space-y-2">
            <h2 className="font-display text-lg text-primary text-glow">Race</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {getSelectableRaceKeys().map(key => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRace(key)}
                  onMouseEnter={() => setHoverRace(key)}
                  onMouseLeave={() => setHoverRace(prev => (prev === key ? null : prev))}
                  disabled={rolling}
                  className={`p-3 rounded-md border text-left transition-all hover:border-primary disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-border ${
                    race === key ? 'border-primary bg-primary/10' : 'border-border bg-card'
                  }`}
                >
                  <div className="font-display text-sm text-foreground">{RACE_LABELS[key]}</div>
                  <div className="text-xs text-muted-foreground mt-1 leading-snug">{RACE_DESCRIPTIONS[key]}</div>
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
          </div>

          {/* Wayfarer info card */}
          <div className="p-4 rounded-md border border-primary/40 bg-primary/5">
            <div className="flex items-start gap-3">
              <span className="text-2xl"> </span>
              <div className="space-y-1">
                <h3 className="font-display text-sm text-primary text-glow">You begin as a Wayfarer</h3>
                <p className="text-xs text-muted-foreground leading-snug">
                  No order claims you yet. You start with a sturdy frame (18 HP, 10 AC) and balanced stats, ready
                  to learn the world at your own pace. Ask the folk you meet about the Order Halls — their Recruiters
                  will swear you to a class, and you can switch later at any other hall.
                </p>
              </div>
            </div>
          </div>

          {/* Spacer so sticky bar never overlaps last card on tall screens */}
          <div className="h-2" />

          {/* Sticky live summary */}
          <div className="sticky bottom-0 -mx-6 px-6 py-3 bg-card/95 backdrop-blur border-t border-border">
            {previewStats ? (
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(STAT_LABELS).map(([key, label]) => (
                    <div key={key} className="text-center px-2 py-1 bg-background/60 rounded border border-border min-w-[52px]">
                      <div className="text-[10px] text-muted-foreground leading-none">{label}</div>
                      <div className="text-base font-display text-foreground leading-tight">{previewStats[key]}</div>
                    </div>
                  ))}
                  <div className="flex items-center gap-3 px-2 text-sm">
                    <span className="text-blood font-display">HP {previewHp}</span>
                    <span className="text-muted-foreground font-display">AC {previewAc}</span>
                    <span className="text-primary font-display">Gold 100</span>
                    <span className="text-muted-foreground font-display">Salvage 42</span>
                    <span className="text-muted-foreground font-display">Gems ×6</span>
                  </div>
                </div>
                <Button
                  onClick={handleCreate}
                  disabled={!canCreate || loading || rolling}
                  className="font-display whitespace-nowrap"
                >
                  {loading ? 'Creating...' : rolling ? 'Suggesting name...' : 'Begin as Adventurer'}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <p className="text-sm text-muted-foreground italic">
                  Choose a race to preview your hero's stats.
                </p>
                <Button disabled className="font-display whitespace-nowrap">
                  Begin as Adventurer
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
