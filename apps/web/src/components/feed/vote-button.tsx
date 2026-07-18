import { type ReactNode } from "react";
import { cn } from "../../lib/cn.js";

/** "▲ this is a waste" toggle — filled accent when the visitor has voted. */
export function VoteButton({
  voted,
  onClick,
  className,
  children,
}: {
  voted: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={voted}
      onClick={onClick}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-md border font-semibold transition-colors",
        "focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none",
        voted
          ? "border-accent bg-accent text-white"
          : "border-hairline-strong bg-surface text-body hover:border-ink",
        className,
      )}
    >
      <span aria-hidden>▲</span>
      {children}
    </button>
  );
}
