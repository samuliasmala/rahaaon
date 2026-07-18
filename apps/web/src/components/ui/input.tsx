import { type InputHTMLAttributes, forwardRef } from "react";
import { cn } from "../../lib/cn.js";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full min-w-0 rounded-md border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink",
          "placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...props}
      />
    );
  },
);
