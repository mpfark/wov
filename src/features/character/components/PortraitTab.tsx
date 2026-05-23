import { useEffect, useMemo, useState } from 'react';
import type { Character } from '@/features/character';
import type { InventoryItem } from '@/features/inventory';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useCharacterPortrait } from '@/features/character/hooks/useCharacterPortrait';
import type { PortraitHeight, PortraitBodyType } from '@/lib/character-portrait-prompt';
import { Loader2 } from 'lucide-react';

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

interface Props {
  character: Character;
  equipped: InventoryItem[];
  inCombat?: boolean;
}

interface PortraitMeta {
  description?: string;
  height?: PortraitHeight;
  body_type?: PortraitBodyType;
  generated_at?: string;
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${total}s`;
}

export default function PortraitTab({ character, equipped, inCombat }: Props) {
  const meta = (character as any).portrait_metadata as PortraitMeta | undefined;
  const portraitUrl = (character as any).portrait_url as string | undefined;
  const generatedAt = (character as any).portrait_generated_at as string | null | undefined;

  const [description, setDescription] = useState(meta?.description ?? '');
  const [height, setHeight] = useState<PortraitHeight>(meta?.height ?? 'average');
  const [bodyType, setBodyType] = useState<PortraitBodyType>(meta?.body_type ?? 'average');
  // Optimistic override (used only briefly before the character row refreshes via realtime)
  const [optimistic, setOptimistic] = useState<{ url: string; at: string } | null>(null);

  // Sync editable inputs when switching characters
  useEffect(() => {
    setDescription(meta?.description ?? '');
    setHeight(meta?.height ?? 'average');
    setBodyType(meta?.body_type ?? 'average');
    setOptimistic(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.id]);

  // Once the authoritative row catches up to (or past) the optimistic timestamp, drop the override.
  useEffect(() => {
    if (!optimistic) return;
    if (generatedAt && new Date(generatedAt).getTime() >= new Date(optimistic.at).getTime()) {
      setOptimistic(null);
    }
  }, [generatedAt, optimistic]);

  const localPortraitUrl = optimistic?.url ?? portraitUrl;
  const localGeneratedAt = optimistic?.at ?? generatedAt;

  const { generate, isGenerating } = useCharacterPortrait(character.id);

  // Tick countdown once a minute
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const cooldownRemaining = useMemo(() => {
    if (!localGeneratedAt) return 0;
    const next = new Date(localGeneratedAt).getTime() + COOLDOWN_MS;
    return Math.max(0, next - now);
  }, [localGeneratedAt, now]);

  const onCooldown = cooldownRemaining > 0;
  const disabled = isGenerating || onCooldown || inCombat;

  const handleGenerate = async () => {
    const result = await generate({ description, height, body_type: bodyType });
    if (result) {
      setOptimistic({ url: result.portrait_url, at: result.generated_at });
    }
  };

  return (
    <div className="gap-section">
      {inCombat && (
        <p className="text-[11px] text-center text-muted-foreground italic">
          Portraits cannot be forged while in combat.
        </p>
      )}

      <div className="gap-group">
        <div>
          <Label className="t-label">
            Appearance notes
          </Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 500))}
            placeholder='e.g. "Scarred veteran with silver braids and a crooked nose."'
            className="mt-1 min-h-[72px] text-xs"
            maxLength={500}
            disabled={isGenerating}
          />
          <div className="t-meta text-right mt-0.5">
            {description.length}/500
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="t-label">
              Height
            </Label>
            <Select value={height} onValueChange={(v) => setHeight(v as PortraitHeight)} disabled={isGenerating}>
              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="short">Short</SelectItem>
                <SelectItem value="average">Average</SelectItem>
                <SelectItem value="tall">Tall</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="t-label">
              Body type
            </Label>
            <Select value={bodyType} onValueChange={(v) => setBodyType(v as PortraitBodyType)} disabled={isGenerating}>
              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lean">Lean</SelectItem>
                <SelectItem value="average">Average</SelectItem>
                <SelectItem value="muscular">Muscular</SelectItem>
                <SelectItem value="heavyset">Heavyset</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="text-[10px] text-muted-foreground italic">
          {equipped.length > 0
            ? `Currently equipped (${equipped.length}) will be drawn into the portrait.`
            : 'No gear equipped — your character will appear in simple traveler\'s clothing.'}
        </div>

        <Button
          className="w-full h-8 text-xs font-display"
          onClick={handleGenerate}
          disabled={disabled}
        >
          {isGenerating && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
          {onCooldown
            ? `Available in ${formatRemaining(cooldownRemaining)}`
            : isGenerating
              ? 'Forging…'
              : localPortraitUrl ? 'Regenerate portrait' : 'Forge portrait'}
        </Button>
        <p className="text-[10px] text-muted-foreground text-center italic">
          One portrait per character per 24 hours.
        </p>
      </div>

      <div className="border-t border-border pt-3">
        {localPortraitUrl ? (
          <div className="gap-row">
            <div className="aspect-square w-full rounded border border-border overflow-hidden bg-muted/30">
              <img
                src={localPortraitUrl}
                alt={`${character.name} portrait`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
            {localGeneratedAt && (
              <p className="text-[10px] text-center text-muted-foreground">
                Forged {new Date(localGeneratedAt).toLocaleString()}
              </p>
            )}
          </div>
        ) : (
          <div className="aspect-square w-full rounded border border-dashed border-border flex items-center justify-center p-4">
            <p className="text-xs text-muted-foreground italic text-center">
              Describe your character above and forge their likeness.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
