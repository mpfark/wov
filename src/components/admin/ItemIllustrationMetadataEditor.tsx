import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { ChevronDown, Copy, Check } from 'lucide-react';
import { buildItemIllustrationPrompt, type ItemIllustrationMetadata } from '@/lib/item-illustration-prompt';

type MetadataRecord = Record<string, string>;

interface Props {
  metadata: MetadataRecord;
  onMetadataChange: (metadata: MetadataRecord) => void;
  /** Optional context so prompt preview matches what the server will generate */
  context?: { name?: string; description?: string; rarity?: string; slot?: string | null; item_type?: string };
}

const FIELDS: { key: keyof ItemIllustrationMetadata; label: string; placeholder: string }[] = [
  { key: 'visual_theme', label: 'Visual Theme', placeholder: 'e.g. arcane, draconic, druidic, infernal' },
  { key: 'material', label: 'Material', placeholder: 'e.g. obsidian, mithril, oak, bone' },
  { key: 'silhouette', label: 'Silhouette / Shape', placeholder: 'e.g. curved blade, jagged crown, rounded helm' },
  { key: 'ornamentation', label: 'Ornamentation', placeholder: 'e.g. runes, gemstones, filigree, engravings' },
  { key: 'color_palette', label: 'Color Palette', placeholder: 'e.g. crimson and gold, cold blues, deep greens' },
  { key: 'mood', label: 'Mood', placeholder: 'e.g. menacing, regal, ancient, sacred' },
  { key: 'notable_features', label: 'Notable Features', placeholder: 'e.g. glowing edge, twin spikes, broken hilt' },
];

export default function ItemIllustrationMetadataEditor({ metadata, onMetadataChange, context }: Props) {
  const [open, setOpen] = useState(false);
  const [promptText, setPromptText] = useState('');
  const [copied, setCopied] = useState(false);

  const update = (key: string, value: string) => onMetadataChange({ ...metadata, [key]: value });

  const generate = () => {
    setPromptText(
      buildItemIllustrationPrompt({
        name: context?.name || 'Item',
        description: context?.description,
        rarity: context?.rarity || 'common',
        slot: context?.slot ?? null,
        item_type: context?.item_type || 'equipment',
        metadata,
      }),
    );
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground font-display hover:text-foreground transition-colors w-full mt-2">
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? '' : '-rotate-90'}`} />
        AI Generation Metadata
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 mt-2">
          {FIELDS.map(f => (
            <div key={f.key}>
              <label className="text-[9px] text-muted-foreground/70 block mb-0.5">{f.label}</label>
              <Input
                value={(metadata[f.key] as string) || ''}
                onChange={e => update(f.key, e.target.value)}
                placeholder={f.placeholder}
                className="text-xs h-7"
              />
            </div>
          ))}
          <div>
            <label className="text-[9px] text-muted-foreground/70 block mb-0.5">Prompt Override (optional)</label>
            <Textarea
              value={metadata.prompt_override || ''}
              onChange={e => update('prompt_override', e.target.value)}
              placeholder="Full custom prompt — overrides everything else"
              rows={2}
              className="text-xs"
            />
          </div>
          <div className="flex gap-1.5">
            <Button type="button" variant="outline" size="sm" onClick={generate} className="text-[10px] font-display h-6">
              Preview Prompt
            </Button>
          </div>
          {promptText && (
            <div className="relative">
              <Textarea value={promptText} readOnly rows={4} className="text-[10px] bg-muted/30" />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={copy}
                className="absolute top-1 right-1 h-5 w-5 p-0"
                title="Copy to clipboard"
              >
                {copied ? <Check className="w-3 h-3 text-elvish" /> : <Copy className="w-3 h-3" />}
              </Button>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
