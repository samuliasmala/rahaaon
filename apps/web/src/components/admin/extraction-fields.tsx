import { type AmountType, Category } from "../../api/model/index.js";
import { Input } from "../ui/input.js";
import { FieldLabel } from "../ui/label.js";
import { Select } from "../ui/select.js";
import { Textarea } from "../ui/textarea.js";
import type { ExtractionDraft } from "./extraction-draft.js";

/** The public feed renders these as "", "n.", "yli" and "Ei tiedossa". */
const AMOUNT_TYPE_OPTIONS: { value: AmountType; label: string }[] = [
  { value: "exact", label: "Tarkka" },
  { value: "approx", label: "Arvio (noin)" },
  { value: "min", label: "Vähintään (yli)" },
  { value: "unknown", label: "Ei tiedossa" },
];

/**
 * The editable extraction fields shared by the AI queue and the published
 * table: title + summary + the amount/entity/category grid. Owns no state —
 * the caller holds the draft. Pass `onSave` to save on field blur (the AI
 * queue), or omit it and provide explicit save controls (the published table).
 */
export function ExtractionFields({
  idPrefix,
  draft,
  setDraft,
  onSave,
  summaryLabel = "Tiivistelmä",
}: {
  idPrefix: string;
  draft: ExtractionDraft;
  setDraft: React.Dispatch<React.SetStateAction<ExtractionDraft>>;
  onSave?: () => void;
  summaryLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor={`${idPrefix}-title`}>Otsikko</FieldLabel>
        <Input
          id={`${idPrefix}-title`}
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          onBlur={onSave}
          className="text-[15px] font-semibold"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor={`${idPrefix}-summary`}>{summaryLabel}</FieldLabel>
        <Textarea
          id={`${idPrefix}-summary`}
          value={draft.summary}
          onChange={(e) => setDraft((d) => ({ ...d, summary: e.target.value }))}
          onBlur={onSave}
        />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={`${idPrefix}-amount`}>Summa (€)</FieldLabel>
          <Input
            id={`${idPrefix}-amount`}
            inputMode="numeric"
            value={draft.amount}
            onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
            onBlur={onSave}
            className="font-semibold tabular"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={`${idPrefix}-amount-max`}>Yläraja (€), jos haarukka</FieldLabel>
          <Input
            id={`${idPrefix}-amount-max`}
            inputMode="numeric"
            value={draft.amountMax}
            onChange={(e) => setDraft((d) => ({ ...d, amountMax: e.target.value }))}
            onBlur={onSave}
            className="font-semibold tabular"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={`${idPrefix}-amount-type`}>Summan tarkkuus</FieldLabel>
          <Select
            id={`${idPrefix}-amount-type`}
            value={draft.amountType}
            onChange={(e) => {
              setDraft((d) => ({ ...d, amountType: e.target.value as AmountType }));
            }}
            onBlur={onSave}
          >
            {AMOUNT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={`${idPrefix}-entity`}>Taho</FieldLabel>
          <Input
            id={`${idPrefix}-entity`}
            value={draft.entity}
            onChange={(e) => setDraft((d) => ({ ...d, entity: e.target.value }))}
            onBlur={onSave}
            className="font-medium"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={`${idPrefix}-category`}>Kategoria</FieldLabel>
          <Select
            id={`${idPrefix}-category`}
            value={draft.category}
            onChange={(e) => {
              setDraft((d) => ({ ...d, category: e.target.value as Category }));
            }}
            onBlur={onSave}
          >
            {Object.values(Category).map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={`${idPrefix}-date`}>Artikkelin julkaisupäivä</FieldLabel>
          <Input
            id={`${idPrefix}-date`}
            type="date"
            value={draft.articlePublishedAt}
            onChange={(e) => setDraft((d) => ({ ...d, articlePublishedAt: e.target.value }))}
            onBlur={onSave}
            className="font-medium"
          />
        </div>
      </div>
    </div>
  );
}
