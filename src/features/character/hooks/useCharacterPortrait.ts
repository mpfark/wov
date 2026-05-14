import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import type { PortraitHeight, PortraitBodyType } from '@/lib/character-portrait-prompt';

export interface PortraitResult {
  portrait_url: string;
  generated_at: string;
  next_available_at: string;
}

export function useCharacterPortrait(characterId: string | null) {
  const [isGenerating, setIsGenerating] = useState(false);

  const generate = useCallback(
    async (inputs: {
      description: string;
      height: PortraitHeight;
      body_type: PortraitBodyType;
    }): Promise<PortraitResult | null> => {
      if (!characterId) return null;
      setIsGenerating(true);
      try {
        const { data, error } = await supabase.functions.invoke('ai-character-portrait', {
          body: {
            character_id: characterId,
            description: inputs.description,
            height: inputs.height,
            body_type: inputs.body_type,
          },
        });
        if (error) {
          // Edge function returns body even on non-2xx; surface server message when present.
          const ctx: any = (error as any).context;
          let message = error.message ?? 'Portrait generation failed.';
          if (ctx && typeof ctx.json === 'function') {
            try {
              const j = await ctx.json();
              if (j?.error) message = typeof j.error === 'string' ? j.error : message;
              if (j?.next_available_at) {
                message += ` Next available at ${new Date(j.next_available_at).toLocaleString()}.`;
              }
            } catch { /* ignore */ }
          }
          toast({ title: 'Portrait failed', description: message, variant: 'destructive' });
          return null;
        }
        toast({ title: 'Portrait forged', description: 'Your likeness has been captured.' });
        return data as PortraitResult;
      } finally {
        setIsGenerating(false);
      }
    },
    [characterId],
  );

  return { generate, isGenerating };
}
