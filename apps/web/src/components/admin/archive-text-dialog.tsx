import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { toast } from "sonner";
import {
  getGetApiAdminSubmissionsIdArchiveTextQueryKey,
  useGetApiAdminSubmissionsIdArchiveText,
  usePutApiAdminSubmissionsIdArchiveText,
} from "../../api/admin/admin.js";
import { Button } from "../ui/button.js";
import { Dialog, DialogHeader } from "../ui/dialog.js";
import { Textarea } from "../ui/textarea.js";
import type { ArchiveRef } from "../../api/model/index.js";
import type { QueryKey } from "@tanstack/react-query";

/**
 * Viewer/editor for the archived article text (Markdown). Viewing renders the
 * markdown; editing exposes the raw text — the escape hatch for paywalled
 * articles the archiver couldn't read, which the editor pastes in by hand.
 * Rows without any stored text open straight in edit mode. The archive is
 * submission-scoped wherever the ref came from (submission card, queue card,
 * published item), so the endpoints always address the submission id.
 *
 * On `processed` entries the AI extraction already ran and there is no way to
 * re-run it, so the editor shows a note that edits land in the archive only —
 * on a submission card the same paste feeds the upcoming extraction.
 */
export function ArchiveTextDialog({
  archive,
  url,
  listQueryKeys,
  open,
  onClose,
  processed = false,
}: {
  archive: NonNullable<ArchiveRef>;
  url: string;
  listQueryKeys: readonly QueryKey[];
  open: boolean;
  onClose: () => void;
  processed?: boolean;
}) {
  const queryClient = useQueryClient();
  const textQuery = useGetApiAdminSubmissionsIdArchiveText(archive.submissionId, undefined, {
    query: { enabled: open && archive.hasArchivedText },
  });
  const saveMutation = usePutApiAdminSubmissionsIdArchiveText();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [baseline, setBaseline] = useState("");

  // Fresh slate every time the dialog opens: text-less rows go straight to
  // the editor, rows with text start in the rendered view. Depends on `open`
  // only — a background refetch flipping hasArchivedText mid-edit (another
  // tab saving, list invalidation) must not silently wipe an active draft.
  useEffect(() => {
    if (open) {
      setEditing(!archive.hasArchivedText);
      setDraft("");
      setBaseline("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
  }, [open]);

  function startEditing(initial: string) {
    setDraft(initial);
    setBaseline(initial);
    setEditing(true);
  }

  // A hand-pasted paywalled article is exactly what this editor exists for —
  // an accidental Escape/backdrop click must not silently discard it.
  function requestClose() {
    if (editing && draft.trim() && draft !== baseline) {
      if (!window.confirm("Hylätäänkö tallentamattomat muutokset?")) return;
    }
    onClose();
  }

  async function save() {
    const text = draft.trim();
    if (!text) {
      toast("Teksti ei voi olla tyhjä");
      return;
    }
    try {
      await saveMutation.mutateAsync({ id: archive.submissionId, data: { text } });
    } catch {
      toast("Tallennus epäonnistui. Yritä uudelleen.");
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getGetApiAdminSubmissionsIdArchiveTextQueryKey(archive.submissionId),
      }),
      ...listQueryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    ]);
    toast("Arkistoteksti tallennettu");
    setEditing(false);
  }

  return (
    <Dialog open={open} onClose={requestClose} label="Arkistoitu teksti" className="max-w-[760px]">
      <DialogHeader onClose={requestClose}>
        <div className="flex min-w-0 flex-col">
          <span className="text-[15px] font-semibold">Arkistoitu teksti</span>
          <span className="truncate text-xs text-muted">{url}</span>
        </div>
      </DialogHeader>

      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-4.5 md:p-6">
        {editing ? (
          <>
            <Textarea
              rows={18}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Liitä artikkelin teksti tähän (Markdown)…"
              className="font-mono text-[13px]/relaxed"
            />
            {processed && (
              <p className="text-xs text-muted">
                Muutokset tallentuvat vain arkistoon — tekoälyn esikäsittelyä ei ajeta uudelleen.
              </p>
            )}
            <div className="flex justify-end gap-2.5">
              {archive.hasArchivedText && (
                <Button
                  variant="outline"
                  onClick={() => {
                    if (
                      draft !== baseline &&
                      !window.confirm("Hylätäänkö tallentamattomat muutokset?")
                    ) {
                      return;
                    }
                    setEditing(false);
                  }}
                >
                  Peruuta
                </Button>
              )}
              <Button disabled={saveMutation.isPending} onClick={() => void save()}>
                {saveMutation.isPending ? "Tallennetaan…" : "Tallenna"}
              </Button>
            </div>
          </>
        ) : textQuery.isPending ? (
          <p className="text-sm text-muted">Ladataan…</p>
        ) : textQuery.isError ? (
          <>
            <p className="text-sm text-muted">Arkiston lukeminen epäonnistui.</p>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => startEditing("")}>
                Kirjoita teksti käsin
              </Button>
            </div>
          </>
        ) : (
          <>
            <div
              className={
                "text-sm/[1.6] text-body [&_a]:text-accent [&_a]:underline-offset-2 " +
                "[&_blockquote]:border-l-2 [&_blockquote]:border-hairline-strong [&_blockquote]:pl-3 " +
                "[&_code]:font-mono [&_code]:text-[13px] [&_em]:italic " +
                "[&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-bold " +
                "[&_h3]:text-[15px] [&_h3]:font-semibold [&_hr]:border-hairline " +
                "[&_li]:ml-5 [&_ol_li]:list-decimal [&_strong]:font-semibold " +
                "[&_ul_li]:list-disc [&>*+*]:mt-3"
              }
            >
              {/* No img: the markdown derives from an arbitrary web page, and
                  rendering images would auto-fetch attacker-chosen URLs from
                  the editor's browser (tracking pixels etc.). */}
              <Markdown disallowedElements={["img"]}>{textQuery.data ?? ""}</Markdown>
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => startEditing(textQuery.data ?? "")}>
                Muokkaa
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
