import { cva, type VariantProps } from "class-variance-authority";
import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "../../lib/cn.js";

const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-1.5 font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-accent text-white hover:bg-accent-dark",
        success: "bg-ok text-white hover:bg-ok-dark",
        outline: "border border-hairline-strong bg-surface text-body hover:border-ink",
        outlineDanger: "border border-accent-hairline bg-surface text-accent hover:bg-accent-wash",
        dark: "bg-ink text-white hover:bg-black",
        ghost: "text-body hover:text-ink",
      },
      size: {
        sm: "rounded-md px-3.5 py-2 text-[13px]",
        md: "rounded-md px-[18px] py-2.5 text-sm",
        lg: "rounded-md px-[22px] py-3 text-[15px]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
});
