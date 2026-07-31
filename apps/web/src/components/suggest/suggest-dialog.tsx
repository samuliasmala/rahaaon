import { useQueryClient } from "@tanstack/react-query";
import { Globe } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getGetApiAdminSubmissionsQueryKey } from "../../api/admin/admin.js";
import {
  usePostApiSubmissions,
  usePostApiSubmissionsPreview,
} from "../../api/submissions/submissions.js";
import { isLikelyUrl } from "../../lib/suggest-url.js";
import { useUiStore } from "../../store/ui-store.js";
import { Button } from "../ui/button.js";
import { Dialog, DialogHeader } from "../ui/dialog.js";
import { Input } from "../ui/input.js";

type Step = "input" | "preview" | "done";

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * The reader suggestion flow: paste a link → check the page preview (a
 * google-like result card) → confirm → the link lands in the editorial
 * Ehdotusjono for AI processing. Step transitions happen only in mutation
 * callbacks so the dialog can never wedge between steps.
 */
export function SuggestDialog() {
  const open = useUiStore((s) => s.suggestOpen);
  const closeSuggest = useUiStore((s) => s.closeSuggest);
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>("input");
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState(false);

  const previewMutation = usePostApiSubmissionsPreview({
    mutation: {
      onSuccess: () => setStep("preview"),
      onError: () => toast("Esikatselun haku epäonnistui. Yritä hetken päästä uudelleen."),
    },
  });
  const submitMutation = usePostApiSubmissions({
    mutation: {
      onSuccess: () => {
        // The header badge and the admin Ehdotusjono list are now stale.
        void queryClient.invalidateQueries({ queryKey: getGetApiAdminSubmissionsQueryKey() });
        setStep("done");
      },
      onError: () => toast("Lähetys epäonnistui. Yritä hetken päästä uudelleen."),
    },
  });

  // Fresh slate every time the dialog opens.
  useEffect(() => {
    if (open) {
      setStep("input");
      setUrl("");
      setUrlError(false);
      previewMutation.reset();
      submitMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation objects are unstable; resetting on open is the intent
  }, [open]);

  const preview = previewMutation.data;

  function requestPreview() {
    if (!isLikelyUrl(url)) {
      setUrlError(true);
      return;
    }
    previewMutation.mutate({ data: { url: url.trim() } });
  }

  return (
    <Dialog open={open} onClose={closeSuggest} label="Ehdota rahareikää">
      <DialogHeader onClose={closeSuggest}>
        <span className="font-display text-[17px] font-bold">Ehdota rahareikää</span>
      </DialogHeader>

      {step === "input" && (
        <div className="flex flex-col gap-4.5 p-4.5 md:p-8">
          <p className="text-[15px]/[1.6] text-body">
            Liitä linkki lehtijuttuun tai uutiseen. Näytämme sivun esikatselun — vahvistuksen
            jälkeen linkki siirtyy jonoon tekoälyn luettavaksi, ja toimitus tarkistaa poiminnat
            ennen julkaisua.
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
              if (e.key === "Enter") requestPreview();
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
          <Button size="lg" disabled={previewMutation.isPending} onClick={requestPreview}>
            {previewMutation.isPending ? "Haetaan esikatselua…" : "Lähetä tekoälyn luettavaksi"}
          </Button>
          <p className="text-center text-xs/normal text-muted">
            Ehdotus käsitellään nimettömänä. Vain julkiset lähteet kelpaavat.
          </p>
        </div>
      )}

      {step === "preview" && preview && (
        <div className="flex flex-col gap-4 p-4.5 md:p-8">
          <p className="text-[15px]/[1.6] text-body">
            Tarkista, että linkki osoittaa oikeaan juttuun.
          </p>
          <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface px-5.5 py-5">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="flex size-7 items-center justify-center rounded-full border border-hairline bg-wash-soft text-muted"
              >
                <Globe className="size-4" strokeWidth={1.5} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] font-medium text-ink">
                  {preview.siteName || hostnameOf(preview.url)}
                </span>
                <span className="truncate text-xs text-muted">{preview.url}</span>
              </span>
            </div>
            <p className="text-[18px]/[1.3] font-semibold text-accent">
              {preview.title || hostnameOf(preview.url)}
            </p>
            {preview.description && (
              <p className="text-sm/[1.55] text-body">{preview.description}</p>
            )}
            {!preview.fetched && (
              <p className="text-[13px] text-muted italic">
                Sivun sisältöä ei saatu luettua. Voit silti lähettää linkin — toimitus avaa sen
                käsin.
              </p>
            )}
          </div>
          <Button
            size="lg"
            disabled={submitMutation.isPending}
            onClick={() => submitMutation.mutate({ data: { url: url.trim() } })}
          >
            {submitMutation.isPending ? "Lähetetään…" : "Vahvista ja lähetä jonoon"}
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
            Tekoäly tekee tiivistelmän, jonka toimitus tarkastaa. Juttu julkaistaan, jos raha
            todella on mennyt harakoille.
          </p>
          <Button variant="dark" onClick={closeSuggest} className="mt-1.5 px-7">
            Selvä
          </Button>
        </div>
      )}
    </Dialog>
  );
}
