import { ReactNode } from 'react';
import { Dialog, DialogContent, DialogClose } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * ServicePanelShell — unified parchment-style container for service dialogs
 * (Marketplace, Vendor, Blacksmith, Teleport, Inn, etc.).
 *
 * Layout:
 *   ┌──────────────────────────────────┐
 *   │ Header (icon + title, subtitle, ✕)│  fixed
 *   │ ─── ✦ ───                        │
 *   │ [optional Tabs row]              │  fixed
 *   ├───────────────┬──────────────────┤
 *   │ left (scroll) │ right (scroll)   │  flex-1
 *   ├───────────────┴──────────────────┤
 *   │ footer (optional, pinned)        │  fixed
 *   └──────────────────────────────────┘
 *
 * Container size is fixed via the `service-panel-shell` CSS utility so
 * panels don't grow/shrink with content.
 *
 * Conventions for slot content:
 *  - Section titles: `font-display text-xs text-muted-foreground uppercase tracking-wide`
 *  - Selection highlight on rows: `border-primary bg-primary/10`
 *  - Use <ServicePanelEmpty> for empty states.
 */
export interface ServicePanelShellProps {
  open: boolean;
  onClose: () => void;
  icon: string;
  title: string;
  subtitle?: ReactNode;
  headerActions?: ReactNode;
  tabs?: ReactNode;
  left: ReactNode;
  right?: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
  singleColumn?: boolean;
  /** Optional left/right column titles rendered as sticky sub-headers. */
  leftTitle?: ReactNode;
  rightTitle?: ReactNode;
}

export function ServicePanelShell({
  open,
  onClose,
  icon,
  title,
  subtitle,
  headerActions,
  tabs,
  left,
  right,
  footer,
  size = 'lg',
  singleColumn = false,
  leftTitle,
  rightTitle,
}: ServicePanelShellProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className={cn(
          'service-panel-shell',
          size === 'md' && 'service-panel-shell--md',
          'p-0 border-none bg-transparent shadow-none',
          // Hide the default radix close button — we render our own wax seal.
          '[&>button.absolute]:hidden',
        )}
      >
        <div className="scroll-panel-inner relative rounded-lg flex flex-col h-full overflow-hidden">
          {/* Corner flourishes */}
          <span className="scroll-corner top-1.5 left-2.5">❧</span>
          <span className="scroll-corner top-1.5 right-2.5 scale-x-[-1]">❧</span>
          <span className="scroll-corner bottom-1.5 left-2.5 rotate-180 scale-x-[-1]">❧</span>
          <span className="scroll-corner bottom-1.5 right-2.5 rotate-180">❧</span>

          {/* Wax-seal close */}
          <DialogClose className="wax-seal-close">✕</DialogClose>

          {/* === Header === */}
          <div className="px-5 pt-4 pb-1 shrink-0">
            <div className="flex items-center justify-center gap-3 pr-8">
              <h2 className="font-display text-lg text-primary text-glow text-center tracking-wide">
                {icon} {title}
              </h2>
              {headerActions && (
                <div className="ml-auto flex items-center gap-2">{headerActions}</div>
              )}
            </div>
            {subtitle && (
              <div className="mt-1 text-center text-xs text-muted-foreground">
                {subtitle}
              </div>
            )}
            <div className="scroll-divider">── ✦ ──</div>
          </div>

          {/* === Tabs row === */}
          {tabs && <div className="px-5 pb-2 shrink-0">{tabs}</div>}

          {/* === Body === */}
          <div className="flex-1 min-h-0 px-5 pb-3">
            {singleColumn || !right ? (
              <div className="h-full overflow-y-auto pr-1">
                {leftTitle && (
                  <h3 className="font-display text-xs text-muted-foreground uppercase tracking-wide mb-2">
                    {leftTitle}
                  </h3>
                )}
                {left}
              </div>
            ) : (
              <div className="h-full grid grid-cols-1 sm:grid-cols-2 gap-4 min-h-0">
                <div className="min-h-0 flex flex-col">
                  {leftTitle && (
                    <h3 className="font-display text-xs text-muted-foreground uppercase tracking-wide mb-2 shrink-0">
                      {leftTitle}
                    </h3>
                  )}
                  <div className="flex-1 min-h-0 overflow-y-auto pr-1">{left}</div>
                </div>
                <div className="min-h-0 flex flex-col sm:border-l sm:border-[hsl(var(--gold)/0.2)] sm:pl-4">
                  {rightTitle && (
                    <h3 className="font-display text-xs text-muted-foreground uppercase tracking-wide mb-2 shrink-0">
                      {rightTitle}
                    </h3>
                  )}
                  <div className="flex-1 min-h-0 overflow-y-auto pr-1">{right}</div>
                </div>
              </div>
            )}
          </div>

          {/* === Footer === */}
          {footer && (
            <div className="shrink-0 border-t border-[hsl(var(--gold)/0.2)] px-5 py-3 bg-background/20">
              {footer}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Standardized empty-state line for service panel slots. */
export function ServicePanelEmpty({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground italic">{children}</p>;
}

export default ServicePanelShell;
