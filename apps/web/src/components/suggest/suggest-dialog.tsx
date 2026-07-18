import { useEffect, useMemo, useState } from "react";
import { cn } from "../../lib/cn.js";
import { formatEur } from "../../lib/format.js";
import {
  AI_STEP_INTERVAL_MS,
  AI_STEPS,
  isLikelyUrl,
  mockExtractArticle,
} from "../../lib/suggestion-ai.js";
import { useAppStore } from "../../store/app-store.js";
import { useUiStore } from "../../store/ui-store.js";
import { Button } from "../ui/button.js";
import { Dialog, DialogHeader } from "../ui/dialog.js";
import { Input } from "../ui/input.js";
import { Pill } from "../ui/pill.js";

type Step = "input" | "processing" | "preview" | "done";

/**
 * The reader suggestion flow: paste a link → simulated AI pipeline → check the
 * extraction → lands in the editorial queue.
 */
export function SuggestDialog() {
  const open = useUiStore((s) => s.suggestOpen);
  const closeSuggest = useUiStore((s) => s.closeSuggest);
  const submitSuggestion = useAppStore((s) => s.submitSuggestion);

  const [step, setStep] = useState<Step>("input");
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState(false);
  const [doneSteps, setDoneSteps] = useState(0);

  // Fresh slate every time the dialog opens.
  useEffect(() => {
    if (open) {
      setStep("input");
      setUrl("");
      setUrlError(false);
      setDoneSteps(0);
    }
  }, [open]);

  // Simulated pipeline: tick through the steps, then show the preview.
  useEffect(() => {
    if (step !== "processing") return;
    const timer = setInterval(() => {
      setDoneSteps((n) => Math.min(n + 1, AI_STEPS.length));
    }, AI_STEP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [step]);

  useEffect(() => {
    if (step === "processing" && doneSteps >= AI_STEPS.length) setStep("preview");
  }, [step, doneSteps]);

  const preview = useMemo(() => mockExtractArticle(url), [url]);

  function submitUrl() {
    if (!isLikelyUrl(url)) {
      setUrlError(true);
      return;
    }
    setDoneSteps(0);
    setStep("processing");
  }

  function confirmSubmit() {
    submitSuggestion(url.trim(), preview);
    setStep("done");
  }

  return (
    <Dialog open={open} onClose={closeSuggest} label="Ehdota rahareikää">
      <DialogHeader onClose={closeSuggest}>
        <span className="font-display text-[17px] font-bold">Ehdota rahareikää</span>
      </DialogHeader>

      {step === "input" && (
        <div className="flex flex-col gap-4.5 p-4.5 md:p-8">
          <p className="text-[15px]/[1.6] text-body">
            Liitä linkki lehtijuttuun tai uutiseen. Tekoäly lukee jutun, poimii summan ja tahon,
            kategorisoi ja tiivistää — toimitus tarkistaa ennen julkaisua.
          </p>
          <Input
            autoFocus
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setUrlError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitUrl();
            }}
            placeholder="https://esimerkiksi.hs.fi/juttu…"
            aria-invalid={urlError}
            className="px-4 py-3.5 text-[15px] font-medium"
          />
          {urlError && (
            <p className="text-[13px] font-medium text-accent">
              Lisää kelvollinen linkki (alkaa http…).
            </p>
          )}
          <Button size="lg" onClick={submitUrl}>
            Lähetä tekoälyn luettavaksi
          </Button>
          <p className="text-center text-xs/normal text-muted">
            Ehdotus käsitellään nimettömänä. Vain julkiset lähteet kelpaavat.
          </p>
        </div>
      )}

      {step === "processing" && (
        <div className="flex flex-col items-center gap-4.5 px-8 py-10">
          <div
            aria-hidden
            className="size-9 animate-spin rounded-full border-[3px] border-hairline border-t-accent"
          />
          <ul className="flex w-full max-w-[360px] flex-col gap-2.5">
            {AI_STEPS.map((label, i) => (
              <li
                key={label}
                className={cn(
                  "flex items-center gap-2.5 text-sm font-medium",
                  i < doneSteps ? "text-ok" : i === doneSteps ? "text-ink" : "text-faint",
                )}
              >
                <span aria-hidden className="w-4.5 text-center">
                  {i < doneSteps ? "✓" : i === doneSteps ? "●" : "○"}
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {step === "preview" && (
        <div className="flex flex-col gap-4 p-4.5 md:p-8">
          <div className="flex items-center gap-2.5">
            <Pill className="bg-ok-wash text-ok">Tekoäly luki jutun</Pill>
            <span className="text-[13px] text-muted">Tarkista poimitut tiedot</span>
          </div>
          <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface px-5.5 py-5">
            <p className="font-display text-[26px] font-bold text-accent tabular">
              {formatEur(preview.amount)}
            </p>
            <p className="text-[17px]/[1.35] font-semibold">{preview.title}</p>
            <p className="text-[13px] text-muted">
              {preview.entity} · {preview.category} · {preview.sourceName}
            </p>
            <p className="border-t border-hairline-soft pt-3 text-sm/[1.6] text-body">
              {preview.summary}
            </p>
          </div>
          <Button size="lg" onClick={confirmSubmit}>
            Näyttää oikealta — lähetä toimitukselle
          </Button>
          <Button variant="ghost" onClick={() => setStep("input")}>
            Vaihda linkkiä
          </Button>
        </div>
      )}

      {step === "done" && (
        <div className="flex flex-col items-center gap-3.5 px-8 py-11 text-center">
          <div
            aria-hidden
            className="flex size-13 items-center justify-center rounded-full bg-ok-wash text-2xl text-ok"
          >
            ✓
          </div>
          <p className="font-display text-[21px] font-bold">Kiitos! Ehdotus on jonossa.</p>
          <p className="max-w-[380px] text-sm/[1.6] text-body">
            Toimitus tarkistaa tekoälyn poiminnat ja julkaisee jutun, jos raha todella on mennyt
            harakoille.
          </p>
          <Button variant="dark" onClick={closeSuggest} className="mt-1.5 px-7">
            Selvä
          </Button>
        </div>
      )}
    </Dialog>
  );
}
