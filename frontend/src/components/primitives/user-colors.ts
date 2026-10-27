/**
 * Stable per-user colour: the user id picks a slot, so a user keeps the same colour on every
 * screen and across sessions. Each pair is a saturated "700" fill with white text in light mode
 * and a pale "300" fill with near-black text in dark mode (both >= 4.5:1).
 */
const AVATAR_PALETTE = [
  "bg-teal-700 text-white dark:bg-teal-300 dark:text-teal-950",
  "bg-violet-700 text-white dark:bg-violet-300 dark:text-violet-950",
  "bg-rose-700 text-white dark:bg-rose-300 dark:text-rose-950",
  "bg-blue-700 text-white dark:bg-blue-300 dark:text-blue-950",
  "bg-orange-700 text-white dark:bg-orange-300 dark:text-orange-950",
  "bg-emerald-700 text-white dark:bg-emerald-300 dark:text-emerald-950",
  "bg-fuchsia-700 text-white dark:bg-fuchsia-300 dark:text-fuchsia-950",
  "bg-cyan-700 text-white dark:bg-cyan-300 dark:text-cyan-950",
] as const;

/** Ring/border colour matching the avatar, used to outline a user's pane. */
const OUTLINE_PALETTE = [
  "border-teal-700 dark:border-teal-300",
  "border-violet-700 dark:border-violet-300",
  "border-rose-700 dark:border-rose-300",
  "border-blue-700 dark:border-blue-300",
  "border-orange-700 dark:border-orange-300",
  "border-emerald-700 dark:border-emerald-300",
  "border-fuchsia-700 dark:border-fuchsia-300",
  "border-cyan-700 dark:border-cyan-300",
] as const;

function slot(id: number): number {
  return ((Math.trunc(id) % AVATAR_PALETTE.length) + AVATAR_PALETTE.length) % AVATAR_PALETTE.length;
}

export function userOutlineClass(id: number | null): string {
  return id === null ? "border-foreground" : OUTLINE_PALETTE[slot(id)]!;
}

export function userInitial(name: string): string {
  return (name.trim().charAt(0) || "?").toUpperCase();
}

export function userAvatarClass(id: number): string {
  return AVATAR_PALETTE[slot(id)]!;
}
