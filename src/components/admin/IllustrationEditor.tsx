import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { ChevronDown, Copy, Check, ImageIcon, X, Loader2, ImageOff } from 'lucide-react';
import { buildIllustrationPrompt } from '@/lib/illustration-prompt';
import type { IllustrationMetadata } from '@/lib/illustration-prompt';
import { AdminFormSection } from '@/components/admin/common';

type MetadataRecord = Record<string, string>;

interface IllustrationEditorProps {
  illustrationUrl: string;
  onUrlChange: (url: string) => void;
  metadata: MetadataRecord;
  onMetadataChange: (metadata: MetadataRecord) => void;
  inheritedUrl?: string;
  inheritedSource?: string;
}

const METADATA_FIELDS: { key: keyof IllustrationMetadata; label: string; placeholder: string }[] = [
  { key: 'visual_theme', label: 'Visual Theme', placeholder: 'e.g. forest, desert, volcanic, coastal' },
  { key: 'environment_description', label: 'Environment Description', placeholder: 'Short description of the setting' },
  { key: 'architectural_style', label: 'Architectural Style', placeholder: 'e.g. medieval, ruins, dwarven' },
  { key: 'mood', label: 'Mood', placeholder: 'e.g. serene, ominous, mystical' },
  { key: 'time_of_day', label: 'Time of Day', placeholder: 'e.g. dawn, day, dusk, night' },
  { key: 'weather', label: 'Weather', placeholder: 'e.g. clear, foggy, rainy, snowy' },
  { key: 'color_palette', label: 'Color Palette', placeholder: 'e.g. warm earth tones, cold blues' },
  { key: 'notable_features', label: 'Notable Features', placeholder: 'e.g. ancient tree, lava river, crystal formations' },
];

type LoadState = 'loading' | 'loaded' | 'error';

interface PreviewFrameProps {
  url: string;
  label: string;
  sourceLabel?: string;
  withOverlay?: boolean;
}

function PreviewFrame({ url, label, sourceLabel, withOverlay }: PreviewFrameProps) {
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    setState('loading');
  }, [url]);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <ImageIcon className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground font-display">
          {label}
          {sourceLabel && (
            <span className="ml-1 text-primary/70">— {sourceLabel}</span>
          )}
        </span>
      </div>
      <div className="relative w-full h-24 rounded border border-border overflow-hidden bg-background">
        {state === 'error' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground">
            <ImageOff className="w-4 h-4" />
            <span className="text-[9px] font-display">Image failed to load</span>
          </div>
        ) : (
          <>
            <img
              src={url}
              alt={label}
              className="w-full h-full object-cover"
              onLoad={() => setState('loaded')}
              onError={() => setState('error')}
              style={{ opacity: state === 'loaded' ? 1 : 0, transition: 'opacity 150ms' }}
            />
            {state === 'loading' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {withOverlay && state === 'loaded' && (
              <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/50 pointer-events-none" />
            )}
            {state === 'loaded' && (
              <span className="absolute bottom-1 left-1.5 text-[9px] text-white/70 font-display">
                {withOverlay ? 'In-game preview' : 'Raw'}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function IllustrationEditor({
  illustrationUrl, onUrlChange, metadata, onMetadataChange,
  inheritedUrl, inheritedSource,
}: IllustrationEditorProps) {
  const [metaOpen, setMetaOpen] = useState(false);
  const [promptText, setPromptText] = useState('');
  const [copied, setCopied] = useState(false);

  const hasLocal = !!illustrationUrl;
  const effectiveUrl = illustrationUrl || inheritedUrl || '';
  const effectiveSource = illustrationUrl ? 'This entity' : inheritedSource || '';
  const showBothPreviews = hasLocal && !!inheritedUrl && illustrationUrl !== inheritedUrl;

  const updateMeta = (key: string, value: string) => {
    onMetadataChange({ ...metadata, [key]: value });
  };

  const generatePrompt = () => {
    setPromptText(buildIllustrationPrompt(metadata));
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback */ }
  };

  return (
    <AdminFormSection title="Illustration">
      <div className="space-y-2">
        <div>
          <div className="flex gap-1.5">
            <Input
              placeholder="Image URL (e.g. https://...)"
              value={illustrationUrl}
              onChange={e => onUrlChange(e.target.value)}
              className="text-xs"
            />
            {hasLocal && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onUrlChange('')}
                className="h-9 px-2 shrink-0"
                title="Clear local URL — falls back to parent"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
          <p className="text-[9px] text-muted-foreground/60 mt-0.5">
            Optional. Falls back to parent Area or Region if empty. Multiple entities may reuse the same image.
          </p>
        </div>

        {/* Local illustration preview (only when local differs from inherited) */}
        {showBothPreviews && (
          <PreviewFrame
            url={illustrationUrl}
            label="Local Illustration"
            sourceLabel="This entity"
          />
        )}

        {/* Effective Background Preview */}
        {effectiveUrl && (
          <PreviewFrame
            url={effectiveUrl}
            label="Effective Background"
            sourceLabel={effectiveSource ? `From ${effectiveSource}` : undefined}
            withOverlay
          />
        )}

        {/* AI Generation Metadata */}
        <Collapsible open={metaOpen} onOpenChange={setMetaOpen}>
          <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground font-display hover:text-foreground transition-colors w-full">
            <ChevronDown className={`w-3 h-3 transition-transform ${metaOpen ? '' : '-rotate-90'}`} />
            AI Generation Metadata
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-2 mt-2">
              {METADATA_FIELDS.map(f => (
                <div key={f.key}>
                  <label className="text-[9px] text-muted-foreground/70 block mb-0.5">{f.label}</label>
                  <Input
                    value={(metadata[f.key] as string) || ''}
                    onChange={e => updateMeta(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className="text-xs h-7"
                  />
                </div>
              ))}
              <div>
                <label className="text-[9px] text-muted-foreground/70 block mb-0.5">Prompt Override (optional)</label>
                <Textarea
                  value={metadata.prompt_override || ''}
                  onChange={e => updateMeta('prompt_override', e.target.value)}
                  placeholder="Full custom prompt — overrides generated prompt"
                  rows={2}
                  className="text-xs"
                />
              </div>

              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" onClick={generatePrompt} className="text-[10px] font-display h-6">
                  Generate Prompt
                </Button>
              </div>

              {promptText && (
                <div className="relative">
                  <Textarea value={promptText} readOnly rows={4} className="text-[10px] bg-muted/30" />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={copyPrompt}
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
      </div>
    </AdminFormSection>
  );
}
