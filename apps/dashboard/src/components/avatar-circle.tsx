/**
 * Same hash-based color + initials idiom as admin/seller-licences/
 * seller-licences-table.tsx's local avatarClass/initials helpers, pulled
 * out into a real component so profile-style pages don't each redefine it.
 * The color is derived from `seed` (usually an id) so the same
 * person/shop always gets the same color across pages, not from the
 * displayed name (which can repeat across different people).
 */
const AVATAR_PALETTE = [
  "bg-earth-100 text-earth-700",
  "bg-green-100 text-green-700",
  "bg-blue-100 text-blue-700",
  "bg-pink-100 text-pink-700",
];

const SIZE_CLASSES = {
  md: "h-9 w-9 text-xs",
  lg: "h-16 w-16 text-xl",
} as const;

function colorClass(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]!;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function AvatarCircle({
  name,
  seed,
  size = "md",
  className = "",
}: {
  name: string;
  /** What the color is derived from — usually the record's id, so it stays stable even if the name changes. */
  seed: string;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-bold ${SIZE_CLASSES[size]} ${colorClass(seed)} ${className}`}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </div>
  );
}
