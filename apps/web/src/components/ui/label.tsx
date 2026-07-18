import { type LabelHTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

/** Small uppercase field label used across admin forms and info panels. */
export function FieldLabel({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    // eslint-disable-next-line jsx-a11y/label-has-associated-control -- callers pair it via htmlFor
    <label
      className={cn("text-[11px] font-semibold tracking-[0.08em] text-muted uppercase", className)}
      {...props}
    />
  );
}
