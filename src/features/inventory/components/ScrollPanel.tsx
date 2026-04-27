import { ReactNode } from 'react';
import { DialogContent, DialogClose } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * @deprecated Prefer ServicePanelShell from `@/components/ui/ServicePanelShell`
 * for new service dialogs. ScrollPanel is kept for legacy single-column
 * parchment dialogs and uses the same parchment styling.
 *
 * Note: this component must be rendered inside a <Dialog> by the caller —
 * the caller owns open/close state.
 */
interface ScrollPanelProps {
  icon: string;
  title: string;
  children: ReactNode;
  className?: string;
  wide?: boolean;
}

export default function ScrollPanel({ icon, title, children, className, wide }: ScrollPanelProps) {
  return (
    <DialogContent
      className={cn(
        'scroll-panel max-h-[80vh] overflow-y-auto p-0 border-none bg-transparent shadow-none',
        wide ? 'max-w-2xl min-h-[60vh]' : 'max-w-lg',
        '[&>button.absolute]:hidden',
        className
      )}
    >
      <div className="scroll-panel-inner relative rounded-lg p-5 pt-4">
        <span className="scroll-corner top-1.5 left-2.5">❧</span>
        <span className="scroll-corner top-1.5 right-2.5 scale-x-[-1]">❧</span>
        <span className="scroll-corner bottom-1.5 left-2.5 rotate-180 scale-x-[-1]">❧</span>
        <span className="scroll-corner bottom-1.5 right-2.5 rotate-180">❧</span>

        <DialogClose className="wax-seal-close">✕</DialogClose>

        <h2 className="font-display text-lg text-primary text-glow text-center tracking-wide">
          {icon} {title}
        </h2>

        <div className="scroll-divider">── ✦ ──</div>

        <div className="mt-3">
          {children}
        </div>
      </div>
    </DialogContent>
  );
}
