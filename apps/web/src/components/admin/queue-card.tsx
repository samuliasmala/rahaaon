import { toast } from "sonner";
import { cn } from "../../lib/cn.js";
import { CATEGORIES, type Category, type QueueItem } from "../../lib/types.js";
import { useAppStore } from "../../store/app-store.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { FieldLabel } from "../ui/label.js";
import { Pill } from "../ui/pill.js";
import { Select } from "../ui/select.js";
import { Textarea } from "../ui/textarea.js";

function confidenceClasses(confidence: number): string {
  if (confidence >= 85) return "bg-ok-wash text-ok";
  if (confidence >= 70) return "bg-warn-wash text-warn";
  return "bg-accent-wash text-accent";
}

/** One AI-preprocessed suggestion: editable extraction + source panel + verdict. */
export function QueueCard({ entry }: { entry: QueueItem }) {
  const updateQueueItem = useAppStore((s) => s.updateQueueItem);
  const approveQueueItem = useAppStore((s) => s.approveQueueItem);
  const rejectQueueItem = useAppStore((s) => s.rejectQueueItem);

  return (
    <section className="animate-in overflow-hidden rounded-[10px] border border-hairline bg-surface duration-250 fade-in slide-in-from-bottom-[10px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline bg-wash px-4.5 py-3.5">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-body uppercase">
          Tekoälyn esikäsittelemä ehdotus
        </span>
        <Pill className={cn(confidenceClasses(entry.confidence), "tabular")}>
          AI-varmuus {entry.confidence}%
        </Pill>
        <span className="ml-auto text-xs text-muted">Saapunut {entry.received}</span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 p-4.5 md:grid-cols-[minmax(0,1fr)_320px] md:p-8">
        <div className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor={`queue-title-${entry.id}`}>Otsikko</FieldLabel>
            <Input
              id={`queue-title-${entry.id}`}
              value={entry.title}
              onChange={(e) => updateQueueItem(entry.id, { title: e.target.value })}
              className="text-[15px] font-semibold"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor={`queue-summary-${entry.id}`}>Tekoälyn tiivistelmä</FieldLabel>
            <Textarea
              id={`queue-summary-${entry.id}`}
              value={entry.summary}
              onChange={(e) => updateQueueItem(entry.id, { summary: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor={`queue-amount-${entry.id}`}>Summa (€)</FieldLabel>
              <Input
                id={`queue-amount-${entry.id}`}
                inputMode="numeric"
                value={entry.amount}
                onChange={(e) => updateQueueItem(entry.id, { amount: e.target.value })}
                className="font-semibold tabular"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor={`queue-entity-${entry.id}`}>Taho</FieldLabel>
              <Input
                id={`queue-entity-${entry.id}`}
                value={entry.entity}
                onChange={(e) => updateQueueItem(entry.id, { entity: e.target.value })}
                className="font-medium"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor={`queue-category-${entry.id}`}>Kategoria</FieldLabel>
              <Select
                id={`queue-category-${entry.id}`}
                value={entry.category}
                onChange={(e) =>
                  updateQueueItem(entry.id, { category: e.target.value as Category })
                }
              >
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-wash-soft px-4 py-3.5">
            <p className="text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
              Lähde
            </p>
            <a
              href={entry.url}
              target="_blank"
              rel="noreferrer"
              className="text-[13px]/[1.4] font-medium break-all text-accent hover:text-accent-deep"
            >
              {entry.url}
            </a>
            <p className="text-xs text-muted">
              {entry.sourceName} · haettu ja arkistoitu automaattisesti
            </p>
          </div>
          <div className="flex flex-col gap-1.5 rounded-lg border border-hairline bg-wash-soft px-4 py-3.5">
            <p className="text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
              Tekoälyn huomiot
            </p>
            <p className="text-[13px]/[1.5] text-body">{entry.aiNote}</p>
          </div>
          <div className="mt-auto flex gap-2.5 pt-1">
            <Button
              variant="success"
              className="flex-1"
              onClick={() => {
                approveQueueItem(entry.id);
                toast("Julkaistu etusivulle");
              }}
            >
              Hyväksy ja julkaise
            </Button>
            <Button
              variant="outlineDanger"
              onClick={() => {
                rejectQueueItem(entry.id);
                toast("Ehdotus hylätty");
              }}
            >
              Hylkää
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
