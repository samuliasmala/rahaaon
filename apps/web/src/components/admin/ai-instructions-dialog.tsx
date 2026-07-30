import { useId, useState } from "react";
import { Button } from "../ui/button.js";
import { Dialog, DialogHeader } from "../ui/dialog.js";
import { FieldLabel } from "../ui/label.js";
import { Textarea } from "../ui/textarea.js";

/**
 * The "AI processing with editor instructions" dialog shared by the
 * Ehdotusjono (first pass) and the AI-queue / published reprocess actions.
 * The instructions are optional — an empty textarea submits as undefined and
 * the extraction runs with the default prompt alone. The entered text is kept
 * across open/close on purpose: a redraft is often "run it again with a
 * sharper hint".
 */
export function AiInstructionsDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional warning/context line shown above the instructions field. */
  description?: string;
  confirmLabel: string;
  onSubmit: (instructions: string | undefined) => void;
}) {
  const id = useId();
  const [instructions, setInstructions] = useState("");

  return (
    <Dialog open={open} onClose={onClose} label={title} className="max-w-[520px]">
      <DialogHeader onClose={onClose}>
        <h2 className="font-display text-lg font-bold tracking-[-0.01em]">{title}</h2>
      </DialogHeader>
      <div className="flex flex-col gap-4 p-4.5 md:p-7">
        {description && <p className="text-sm/[1.55] text-body">{description}</p>}
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={id}>Ohjeet tekoälylle (valinnainen)</FieldLabel>
          <Textarea
            id={id}
            autoFocus
            rows={4}
            maxLength={2000}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Esim. Poimi hankkeen kokonaiskustannus, älä pelkkää vuosikustannusta."
          />
        </div>
        <div className="flex justify-end gap-2.5">
          <Button variant="outline" onClick={onClose}>
            Peruuta
          </Button>
          <Button onClick={() => onSubmit(instructions.trim() || undefined)}>{confirmLabel}</Button>
        </div>
      </div>
    </Dialog>
  );
}
