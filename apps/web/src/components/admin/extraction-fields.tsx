import { type ComponentProps, useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { usePostApiAdminKeywordsGenerate } from "../../api/admin/admin.js";
import { type AmountType, Category } from "../../api/model/index.js";
import { groupEuroInput } from "../../lib/format.js";
import { Button } from "../ui/button.js";
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
 * Validation messages for the fields a feed item can't do without, shown under
 * the inputs. The caller decides when they apply — the Julkaisujono fills them in
 * when the editor tries to publish a card that is still missing something.
 */
export interface ExtractionFieldErrors {
  title?: string;
  summary?: string;
  entity?: string;
}

/** The shared "this field is required" note under an input. */
function FieldError({ message }: { message?: string | undefined }) {
  if (!message) return null;
  return <p className="text-[13px] font-medium text-accent">{message}</p>;
}

function indexAfterDigits(text: string, digitCount: number): number {
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (seen === digitCount) return i;
    if (/\d/.test(text.charAt(i))) seen++;
  }
  return text.length;
}

/** A euro amount input that regroups its digits in threes as the editor types. */
function AmountInput({
  value,
  onValueChange,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const digitsBeforeCaret = useRef<number | null>(null);

  // Regrouping rewrites the value, which would throw the caret to the end.
  useLayoutEffect(() => {
    if (digitsBeforeCaret.current === null) return;
    const caret = indexAfterDigits(value, digitsBeforeCaret.current);
    inputRef.current?.setSelectionRange(caret, caret);
    digitsBeforeCaret.current = null;
  });

  return (
    <Input
      {...props}
      ref={inputRef}
      inputMode="numeric"
      value={value}
      onChange={(e) => {
        const typed = e.target.value;
        const caret = e.target.selectionStart ?? typed.length;
        digitsBeforeCaret.current = typed.slice(0, caret).replace(/\D/g, "").length;
        onValueChange(groupEuroInput(typed));
      }}
    />
  );
}

/**
 * The editable extraction fields shared by the Julkaisujono and the published
 * table: title + summary + the amount/entity/category grid. Owns no state —
 * the caller holds the draft. Pass `onSave` to save on field blur (the
 * Julkaisujono), or omit it and provide explicit save controls (the published
 * table).
 */
export function ExtractionFields({
  idPrefix,
  draft,
  setDraft,
  onSave,
  summaryLabel = "Tiivistelmä",
  busy = false,
  disabled = false,
  errors,
}: {
  idPrefix: string;
  draft: ExtractionDraft;
  setDraft: React.Dispatch<React.SetStateAction<ExtractionDraft>>;
  onSave?: () => void;
  summaryLabel?: string;
  /** True while the caller is saving/approving — blocks a racing keyword generation. */
  busy?: boolean;
  /** Locks every field — e.g. while a reprocess is about to replace their values. */
  disabled?: boolean;
  /** Per-field validation messages; absent while nothing has been validated. */
  errors?: ExtractionFieldErrors | undefined;
}) {
  const keywordsMutation = usePostApiAdminKeywordsGenerate();

  // Blur-saving callers (the Julkaisujono) never see a blur from the generate
  // button, so a generation asks for a save itself — via an effect, one render
  // later, when `onSave` closes over the draft that includes the new keywords.
  const saveAfterGenerate = useRef(false);
  useEffect(() => {
    if (!saveAfterGenerate.current) return;
    saveAfterGenerate.current = false;
    onSave?.();
  });

  // Drafts keywords from the fields as currently edited, not the saved row.
  async function generateKeywords() {
    let keywords: string[];
    try {
      const result = await keywordsMutation.mutateAsync({
        data: {
          title: draft.title,
          summary: draft.summary.slice(0, 2000),
          entity: draft.entity,
          category: draft.category,
        },
      });
      keywords = result.keywords;
    } catch {
      toast("Avainsanojen luonti epäonnistui. Yritä uudelleen.");
      return;
    }
    // Never blank a hand-curated field over an empty AI answer.
    if (keywords.length === 0) {
      toast("Tekoäly ei löytänyt avainsanoja — kirjoita ne käsin.");
      return;
    }
    setDraft((d) => ({ ...d, keywords: keywords.join(", ") }));
    saveAfterGenerate.current = true;
  }

  return (
    // A fieldset so `disabled` reaches every input natively, with no per-field
    // wiring. min-w-0 counters the fieldset's min-content default, which would
    // otherwise let long values break the grid.
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor={`${idPrefix}-title`}>Otsikko</FieldLabel>
        <Input
          id={`${idPrefix}-title`}
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          onBlur={onSave}
          aria-invalid={!!errors?.title}
          className="text-[15px] font-semibold"
        />
        <FieldError message={errors?.title} />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor={`${idPrefix}-article-title`}>
          Artikkelin otsikko (lähdelinkin teksti)
        </FieldLabel>
        <Input
          id={`${idPrefix}-article-title`}
          value={draft.articleTitle}
          onChange={(e) => setDraft((d) => ({ ...d, articleTitle: e.target.value }))}
          onBlur={onSave}
          placeholder="Tyhjä = yleinen linkkiteksti"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor={`${idPrefix}-summary`}>{summaryLabel}</FieldLabel>
        <Textarea
          id={`${idPrefix}-summary`}
          rows={5}
          value={draft.summary}
          onChange={(e) => setDraft((d) => ({ ...d, summary: e.target.value }))}
          onBlur={onSave}
          aria-invalid={!!errors?.summary}
        />
        <FieldError message={errors?.summary} />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor={`${idPrefix}-quote`}>Sitaatti artikkelista, jos on</FieldLabel>
        <Textarea
          id={`${idPrefix}-quote`}
          rows={3}
          value={draft.quote}
          onChange={(e) => setDraft((d) => ({ ...d, quote: e.target.value }))}
          onBlur={onSave}
          className="font-serif italic"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor={`${idPrefix}-keywords`}>Avainsanat (pilkulla erotettuna)</FieldLabel>
          <Button
            variant="ghost"
            size="sm"
            className="p-0 text-xs text-accent hover:text-accent-deep"
            disabled={
              busy || keywordsMutation.isPending || !draft.title.trim() || !draft.summary.trim()
            }
            onClick={() => void generateKeywords()}
          >
            {keywordsMutation.isPending ? "Luodaan…" : "Luo tekoälyllä"}
          </Button>
        </div>
        <Input
          id={`${idPrefix}-keywords`}
          value={draft.keywords}
          onChange={(e) => setDraft((d) => ({ ...d, keywords: e.target.value }))}
          onBlur={onSave}
          placeholder="esim. tietojärjestelmä, budjettiylitys"
        />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={`${idPrefix}-amount`}>Summa (€)</FieldLabel>
          <AmountInput
            id={`${idPrefix}-amount`}
            value={draft.amount}
            onValueChange={(amount) => setDraft((d) => ({ ...d, amount }))}
            onBlur={onSave}
            className="font-semibold tabular"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={`${idPrefix}-amount-max`}>Yläraja (€), jos haarukka</FieldLabel>
          <AmountInput
            id={`${idPrefix}-amount-max`}
            value={draft.amountMax}
            onValueChange={(amountMax) => setDraft((d) => ({ ...d, amountMax }))}
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
            aria-invalid={!!errors?.entity}
            className="font-medium"
          />
          <FieldError message={errors?.entity} />
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
    </fieldset>
  );
}
