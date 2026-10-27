import * as React from "react";

import { UserChip } from "@/components/primitives/user-chip";
import { userOutlineClass } from "@/components/primitives/user-colors";
import { SelectedUserPaneProvider } from "@/hooks/use-selected-user";
import { cn } from "@/utils";

export interface ComparePaneSpec {
  side: "left" | "right";
  userId: number | null;
  name: string;
  setUserId: (id: number | null) => void;
}

export interface ComparePanesProps {
  panes: readonly [ComparePaneSpec, ComparePaneSpec];
  /** Render the routed screen (called once per pane, inside that pane's provider). */
  children: () => React.ReactNode;
  /** Label the pane that owns keyboard shortcuts (Review). */
  showShortcutBadge: boolean;
}

/**
 * Compare mode: the current screen rendered twice, left/right (stacked below `lg`), each inside a
 * provider pinning that pane's user. Only one pane (the last focused/clicked) handles global
 * keyboard shortcuts.
 */
export function ComparePanes({ panes, children, showShortcutBadge }: ComparePanesProps) {
  const [active, setActive] = React.useState<"left" | "right">("left");
  return (
    <div data-testid="compare-panes" className="grid min-w-0 gap-4 lg:grid-cols-2">
      {panes.map((pane) => {
        const isActive = active === pane.side;
        return (
          <section
            key={pane.side}
            data-testid="compare-pane"
            data-pane={pane.side}
            aria-label={`${pane.side === "left" ? "Left" : "Right"} pane: ${pane.userId === null ? "All users" : pane.name}`}
            onFocusCapture={() => setActive(pane.side)}
            onPointerDownCapture={() => setActive(pane.side)}
            className={cn("min-w-0 rounded-lg border-2 p-3", userOutlineClass(pane.userId))}
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <UserChip userId={pane.userId} name={pane.name} size="lg" />
              {showShortcutBadge ? (
                <span className="text-xs text-muted-foreground" data-testid="shortcut-badge">
                  {isActive ? "Keyboard shortcuts active here" : "Click here to use keyboard shortcuts"}
                </span>
              ) : null}
            </div>
            <SelectedUserPaneProvider value={{ userId: pane.userId, setUserId: pane.setUserId, active: isActive }}>
              {children()}
            </SelectedUserPaneProvider>
          </section>
        );
      })}
    </div>
  );
}
