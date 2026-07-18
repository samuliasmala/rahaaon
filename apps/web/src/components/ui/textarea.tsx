import { type TextareaHTMLAttributes, forwardRef } from "react";
import { cn } from "../../lib/cn.js";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 3, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        "w-full min-w-0 resize-y rounded-md border border-hairline-strong bg-surface px-3 py-2.5",
        "text-sm/normal text-ink placeholder:text-muted",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
});
