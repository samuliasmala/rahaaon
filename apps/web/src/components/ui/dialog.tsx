import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "../../lib/cn.js";

/**
 * App-styled modal on the native <dialog> element — focus trap, Escape and
 * ::backdrop come from the platform. Closing by any means (Escape, backdrop
 * click, action buttons) reports through `onClose`. Content is unopinionated;
 * pair with DialogHeader for the standard title row.
 */
export function Dialog({
  open,
  onClose,
  label,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. */
  label: string;
  /** Sizing overrides — the base width is the suggest modal's 620px. */
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    // Backdrop click is a pointer-only convenience; keyboard users close via
    // Escape, which the native <dialog> delivers through the `cancel` event.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(e) => {
        // Escape: keep the element in sync with React state instead of letting
        // the browser close it behind our back.
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // backdrop click
      }}
      className={cn(
        "mx-auto mt-5 mb-auto w-[calc(100vw-20px)] max-w-[620px] rounded-xl bg-paper p-0 md:mt-14",
        "backdrop:bg-ink/55 open:animate-in open:duration-250 open:fade-in open:slide-in-from-bottom-[10px]",
        className,
      )}
    >
      {children}
    </dialog>
  );
}

/** Standard dialog title row: content on the left, ✕ on the right. */
export function DialogHeader({
  onClose,
  className,
  children,
}: {
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-b border-hairline px-4.5 py-3.5 md:px-8 md:py-4.5",
        className,
      )}
    >
      {children}
      <button
        type="button"
        aria-label="Sulje"
        onClick={onClose}
        className="cursor-pointer text-muted transition-colors hover:text-ink"
      >
        <X aria-hidden className="size-5.5" strokeWidth={1.5} />
      </button>
    </div>
  );
}
