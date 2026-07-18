import { ChevronDown } from "lucide-react";
import { type SelectHTMLAttributes, forwardRef } from "react";
import { cn } from "../../lib/cn.js";

/**
 * Native select styled like Input. `appearance-none` strips the platform
 * arrow, so a chevron is drawn on top to keep the dropdown affordance.
 * `className` styles the wrapper (use it for layout: width, margins).
 */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return (
      <div className={cn("relative", className)}>
        <select
          ref={ref}
          className={cn(
            "peer w-full min-w-0 cursor-pointer appearance-none rounded-md border border-hairline-strong",
            "bg-surface py-2.5 pr-8 pl-2.5 text-sm font-medium text-body",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
          {...props}
        />
        <ChevronDown
          aria-hidden
          strokeWidth={2}
          className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted peer-disabled:opacity-60"
        />
      </div>
    );
  },
);
