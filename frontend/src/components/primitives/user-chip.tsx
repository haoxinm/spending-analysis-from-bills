import { cn } from "@/utils";

import { userAvatarClass, userInitial, userOutlineClass } from "./user-colors";

export interface UserAvatarProps {
  /** The user's id, or `null` for "All users". */
  userId: number | null;
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE = { sm: "h-5 w-5 text-[11px]", md: "h-7 w-7 text-sm", lg: "h-9 w-9 text-base" } as const;

/** Decorative coloured initial (circle for a person, rounded square "∗" for All users). */
export function UserAvatar({ userId, name, size = "md", className }: UserAvatarProps) {
  return (
    <span
      aria-hidden="true"
      data-testid="user-avatar"
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-semibold leading-none",
        SIZE[size],
        userId === null ? "rounded-md bg-foreground text-background" : cn("rounded-full", userAvatarClass(userId)),
        className,
      )}
    >
      {userId === null ? "∗" : userInitial(name)}
    </span>
  );
}

export interface UserChipProps {
  userId: number | null;
  /** Display name; ignored for All users (`allLabel` is used). */
  name?: string;
  allLabel?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/** A coloured avatar followed by the user's name — the app's one way to show "who". */
export function UserChip({ userId, name = "", allLabel = "All users", size = "md", className }: UserChipProps) {
  const label = userId === null ? allLabel : name;
  return (
    <span
      data-testid="user-chip"
      className={cn(
        "inline-flex items-center gap-2 rounded-full border-2 bg-background py-0.5 pl-0.5 pr-3 font-semibold text-foreground",
        userOutlineClass(userId),
        size === "lg" ? "text-base" : "text-sm",
        className,
      )}
    >
      <UserAvatar userId={userId} name={label} size={size} />
      <span>{label}</span>
    </span>
  );
}
