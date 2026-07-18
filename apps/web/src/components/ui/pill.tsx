import { type HTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

/** Small rounded status pill (AI confidence, "Tekoäly luki jutun"…). */
export function Pill({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold",
        className,
      )}
      {...props}
    />
  );
}
