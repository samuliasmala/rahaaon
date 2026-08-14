import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { submissionArchiveRef } from "./archive-ref.js";
import { ArchiveTextDialog } from "./archive-text-dialog.js";
import {
  getGetApiAdminSubmissionsByUrlQueryKey,
  getGetApiAdminSubmissionsQueryKey,
  useGetApiAdminSubmissionsByUrl,
  usePostApiAdminSubmissions,
} from "../../api/admin/admin.js";
import { Button } from "../ui/button.js";
import type { UrlSubmission } from "../../api/model/index.js";

/**
 * The admin end of the capture tool (see lib/capture-bookmarklet.ts): the
 * bookmarklet copies the article it read from the editor's logged-in browser
 * session and links here with `?kaappaus=<artikkelin osoite>`. This strip looks
 * the address up, and one click pastes the clipboard into that submission's
 * archive — where the AI extraction reads it, exactly as if the server had
 * managed to fetch the page itself.
 *
 * An article nobody has submitted yet is the other half of the flow: the editor
 * found it themselves, so the same button creates the submission first.
 *
 * The clipboard is read inside the click handler, before any request goes out —
 * the browser only hands it over while the click's user activation is fresh.
 * When it refuses (permission denied, a browser that won't), the dialog still
 * opens and the editor pastes with Ctrl+V; the text is on the clipboard either
 * way.
 */
export function CaptureBanner({ url, onDismiss }: { url: string; onDismiss: () => void }) {
  const queryClient = useQueryClient();
  const matchQuery = useGetApiAdminSubmissionsByUrl({ url });
  const createMutation = usePostApiAdminSubmissions();
  // A row created here covers the gap until the lookup refetches; once that
  // lands, the fetched row is the fresher one (it knows the text was saved).
  const [created, setCreated] = useState<UrlSubmission | null>(null);
  // "" is a real value here, not "no draft": the dialog opened from a capture
  // always starts in the editor, even when the clipboard came back empty.
  const [draft, setDraft] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const submission = matchQuery.data?.submission ?? created;
  const listQueryKeys = [
    getGetApiAdminSubmissionsQueryKey(),
    getGetApiAdminSubmissionsByUrlQueryKey({ url }),
  ];

  async function readClipboard(): Promise<string | undefined> {
    try {
      const text = await navigator.clipboard.readText();
      return text.trim() ? text : undefined;
    } catch {
      return undefined;
    }
  }

  async function paste() {
    const text = await readClipboard();
    if (!text) toast("Leikepöytää ei voitu lukea — liitä teksti Ctrl+V");
    let entry = submission;
    if (!entry) {
      try {
        entry = await createMutation.mutateAsync({ data: { url } });
      } catch {
        toast("Ehdotuksen luonti epäonnistui. Yritä uudelleen.");
        return;
      }
      setCreated(entry);
      // Not awaited — the editor gets the dialog now, the Ehdotusjono and the
      // lookup catch up behind it.
      void Promise.all(
        listQueryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    }
    // Always open the editor, empty draft or not: an empty one is still the
    // fastest way to the Ctrl+V fallback.
    setDraft(text ?? "");
    setDialogOpen(true);
  }

  async function closeDialog() {
    setDialogOpen(false);
    setDraft("");
    // The row now reports hasArchivedText; the lookup behind this strip (and
    // the queue card under it) must not keep showing the pre-paste state.
    await Promise.all(listQueryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  }

  const status = matchQuery.isPending
    ? "Etsitään ehdotusta…"
    : matchQuery.isError && !created
      ? "Ehdotuksen haku epäonnistui — päivitä sivu ja yritä uudelleen."
      : submission
        ? `Ehdotus löytyi: ${submission.title || submission.siteName || submission.url}`
        : "Tätä linkkiä ei ole vielä ehdotettu — liittäminen luo ehdotuksen.";

  return (
    <section className="mb-6 rounded-[10px] border border-accent-hairline bg-accent-wash px-4.5 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-body uppercase">
          Kaapattu artikkeli
        </span>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate text-[13px] font-medium text-accent hover:text-accent-deep"
        >
          {url}
        </a>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2.5">
        <p className="text-sm/[1.55] text-body">{status}</p>
        <div className="ml-auto flex shrink-0 gap-2.5">
          <Button
            size="sm"
            // A failed lookup must not lead to "Luo ehdotus": the article may
            // well be in the queue already, and creating a duplicate is worse
            // than reloading.
            disabled={
              matchQuery.isPending || (matchQuery.isError && !created) || createMutation.isPending
            }
            onClick={() => void paste()}
          >
            {createMutation.isPending
              ? "Luodaan…"
              : submission
                ? "Liitä teksti"
                : "Luo ehdotus ja liitä teksti"}
          </Button>
          <Button size="sm" variant="outline" onClick={onDismiss}>
            Sulje
          </Button>
        </div>
      </div>
      {submission && (
        <ArchiveTextDialog
          archive={submissionArchiveRef(submission)}
          url={submission.url}
          listQueryKeys={listQueryKeys}
          initialDraft={draft}
          open={dialogOpen}
          onClose={() => void closeDialog()}
        />
      )}
    </section>
  );
}
