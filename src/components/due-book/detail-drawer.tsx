"use client";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

/**
 * A right-hand drawer for "tell me more about this row".
 *
 * Wraps the Base UI dialog under components/ui/sheet, which brings the focus
 * trap, Escape-to-close, scroll lock and backdrop with it — none of which are
 * worth hand-rolling. Two things are re-styled: the panel is painted from the
 * Workshop Due Book tokens rather than the shadcn ones, and it carries the
 * `duebook` class itself, because the sheet portals to <body> and would
 * otherwise sit outside the element those tokens are defined on.
 *
 * Content is whatever the caller passes, so the same drawer serves the call
 * list, the vehicle grid and search.
 */
export function DetailDrawer({
  open,
  onOpenChange,
  eyebrow,
  title,
  subtitle,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="duebook dd-panel"
        // a full slide rather than the 2.5rem nudge the base styles use
        style={{
          background: "var(--surface)",
          color: "var(--ink)",
          borderLeft: "1px solid var(--line)",
          maxWidth: "min(760px, 94vw)",
          width: "min(760px, 94vw)",
          padding: 0,
          gap: 0,
        }}
      >
        <header className="dd-head">
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <SheetTitle
            className="dd-title"
            style={{ color: "var(--ink)", fontSize: 19 }}
          >
            {title}
          </SheetTitle>
          {subtitle && <div className="dd-sub">{subtitle}</div>}
        </header>

        <div className="dd-body">{children}</div>

        {footer && <footer className="dd-foot">{footer}</footer>}
      </SheetContent>
    </Sheet>
  );
}
