import { ReactNode } from 'react';
import { DialogContent, DialogClose } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface ScrollPanelProps {
  icon: string;
  title: string;
  children: ReactNode;
  className?: string;
}

export default function ScrollPanel({ icon, title, children, className }: ScrollPanelProps) {
  return (
    <DialogContent
      className={cn(
        'scroll-panel max-w-lg max-h-[80vh] overflow-y-auto p-0 border-none bg-transparent shadow-none',
        // Hide the default close button from DialogContent
        '[&>button.absolute]:hidden',
        className
      )}
    >
      {/* Ornate parchment frame */}
      <div className="scroll-panel-inner relative rounded-lg p-5 pt-4">
        {/* Corner flourishes */}
        <span className="scroll-corner top-1.5 left-2.5">❧</span>
        <span className="scroll-corner top-1.5 right-2.5 scale-x-[-1]">❧</span>
        <span className="scroll-corner bottom-1.5 left-2.5 rotate-180 scale-x-[-1]">❧</span>
        <span className="scroll-corner bottom-1.5 right-2.5 rotate-180">❧</span>

        {/* Wax-seal close button */}
        <DialogClose className="wax-seal-close">✕</DialogClose>

        {/* Header */}
        <h2 className="font-display text-lg text-primary text-glow text-center tracking-wide">
          {icon} {title}
        </h2>

        {/* Ornate divider */}
        <div className="scroll-divider">── ✦ ──</div>

        {/* Content */}
        <div className="mt-3">
          {children}
        </div>
      </div>
    </DialogContent>
  );
}
