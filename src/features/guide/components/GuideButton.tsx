/**
 * GuideButton — toolbar entry point for the Wayfarer's Guide.
 * Shows an attention dot until the Getting Started entry has been read.
 */
import { Button } from '@/components/ui/button';
import { BookOpen } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  onClick: () => void;
  needsAttention?: boolean;
}

export function GuideButton({ onClick, needsAttention = false }: Props) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClick}
          data-onboarding="guide-button"
          aria-label="Open the Wayfarer's Guide"
          className="relative h-8 w-8"
        >
          <BookOpen className="h-4 w-4" />
          {needsAttention && (
            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary))]" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">The Wayfarer's Guide</TooltipContent>
    </Tooltip>
  );
}
