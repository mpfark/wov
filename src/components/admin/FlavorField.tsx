import { Textarea } from '@/components/ui/textarea';
import { renderFlavor, FLAVOR_MAX_LEN } from '@shared/proc-log-format';

/**
 * Shared admin editor for authored combat flavor text (boss casts, boss crits).
 * Same placeholder set everywhere so authors only learn one syntax.
 */
export const FLAVOR_TOKENS = '{creature} {target} {cast} {damage}';

interface FlavorFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Line shown in the preview when the field is left blank. */
  fallback?: string;
  /** Sample values used to render the preview. */
  sample: { creature: string; target?: string; cast?: string; damage?: number };
  emoji?: string;
  hint?: string;
  rows?: number;
}

export function FlavorField({
  label,
  value,
  onChange,
  placeholder,
  fallback,
  sample,
  emoji,
  hint,
  rows = 2,
}: FlavorFieldProps) {
  const trimmed = (value || '').trim();
  const preview = trimmed
    ? `${emoji ? `${emoji} ` : ''}${renderFlavor(trimmed, sample)}`
    : fallback ?? '';

  return (
    <div className="space-y-1">
      <label className="text-[10px] text-muted-foreground block">
        {label}
        <Textarea
          value={value}
          onChange={e => onChange(e.target.value.slice(0, FLAVOR_MAX_LEN))}
          placeholder={placeholder}
          rows={rows}
          className="text-xs mt-0.5 resize-none"
        />
      </label>
      <p className="text-[9px] text-muted-foreground">
        Placeholders: <span className="font-mono">{FLAVOR_TOKENS}</span>
        {hint ? ` — ${hint}` : ''}
      </p>
      {preview && (
        <p className="text-[9px] text-muted-foreground italic">
          Preview: {preview}
        </p>
      )}
    </div>
  );
}
