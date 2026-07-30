import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ArchiveTextDialog } from "./archive-text-dialog.js";
import { usePostApiAdminSubmissionsIdArchiveRetry } from "../../api/admin/admin.js";
import { Pill } from "../ui/pill.js";
import type { ArchiveRef } from "../../api/model/index.js";
import type { QueryKey } from "@tanstack/react-query";

const linkClasses =
  "text-xs font-medium text-accent underline-offset-2 hover:underline disabled:opacity-50";

/**
 * The page-archive line under an admin entry (submission, queue card or
 * published item): whether the page could be captured (paywall? unreachable?),
 * a viewer/editor for the stored Markdown (also the way to paste a paywalled
 * article in by hand) and the download link. `compact` drops the note and the
 * all-is-well pill for dense layouts (the published table) — a paywalled or
 * failed capture keeps its pill even there. Renders nothing when the ref is
 * null (seeded entries with no submission behind them; queue/item rows whose
 * page was never archived while archiving is off). A `failed` or `missing`
 * archive offers a re-archive action — the API resets the row to pending and
 * the worker takes another shot at the page.
 *
 * `processed` marks refs whose entry already went through the AI extraction
 * (queue cards, published items): the "retried at processing" note would be a
 * false promise there, and text edits no longer feed anything but the archive.
 *
 * `listQueryKeys` names the list queries whose payload carries this ref —
 * saving text in the dialog invalidates them so `hasArchivedText` stays fresh.
 */
export function ArchiveInfo({
  archive,
  url,
  listQueryKeys,
  compact = false,
  processed = false,
}: {
  archive: ArchiveRef;
  url: string;
  listQueryKeys: readonly QueryKey[];
  compact?: boolean;
  processed?: boolean;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  // Covers the whole retry round-trip including the list refetch — the
  // mutation's own isPending drops the moment the POST resolves, which would
  // re-enable the button while the pill still says the archive failed.
  const [retrying, setRetrying] = useState(false);
  const queryClient = useQueryClient();
  const retryMutation = usePostApiAdminSubmissionsIdArchiveRetry();

  if (!archive) return null;

  const pill = {
    pending: { label: "Arkistoidaan…", classes: "bg-wash text-muted" },
    ok: { label: "Sivu arkistoitu", classes: "bg-ok-wash text-ok" },
    paywalled: { label: "Mahdollinen maksumuuri", classes: "bg-warn-wash text-warn" },
    failed: { label: "Sivua ei voitu ladata", classes: "bg-accent-wash text-accent" },
    missing: { label: "Arkisto puuttuu", classes: "bg-warn-wash text-warn" },
    disabled: { label: "Arkistointi ei käytössä", classes: "bg-wash text-muted" },
    // A status this bundle predates (the API enum widened before the browser
    // reloaded) must degrade to a neutral pill, not crash the admin view.
  }[archive.archiveStatus] ?? { label: "Arkiston tila tuntematon", classes: "bg-wash text-muted" };

  const note = {
    pending: null,
    ok: null,
    paywalled: "Sivusta saatiin vain vähän tekstiä — tarkista lähde itse.",
    failed: processed
      ? "Sivua ei saatu talteen — voit lisätä tekstin käsin."
      : "Sivun lataus yritetään uudelleen käsittelyn yhteydessä.",
    missing: "Sivua ei ole arkistoitu — voit arkistoida sen nyt tai lisätä tekstin käsin.",
    disabled: "Sivua ei arkistoida, koska tallennustilaa (S3) ei ole määritetty.",
  }[archive.archiveStatus];

  // 'disabled' has no actions: the archive endpoints refuse without S3.
  const canRetry = archive.archiveStatus === "failed" || archive.archiveStatus === "missing";
  const canOpenText = archive.archiveStatus !== "pending" && archive.archiveStatus !== "disabled";

  async function retryArchive() {
    if (!archive || retrying) return;
    setRetrying(true);
    let started = true;
    try {
      await retryMutation.mutateAsync({ id: archive.submissionId });
    } catch {
      started = false;
      toast("Arkistoinnin käynnistys epäonnistui.");
    }
    try {
      // Refetch on failure too: a 409 means the pill is stale (the archive
      // already finished or is running) and the refetch is what clears it.
      // On success the row is pending again and the lists poll it onward.
      await Promise.all(
        listQueryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    } finally {
      setRetrying(false);
    }
    if (started) toast("Arkistointi käynnistetty");
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 pt-1">
      {compact && archive.archiveStatus === "ok" ? (
        <span className="text-xs text-muted">Arkisto:</span>
      ) : (
        <Pill className={pill.classes}>{pill.label}</Pill>
      )}
      {!compact && note && <span className="text-xs text-muted">{note}</span>}
      {canRetry && (
        <button
          type="button"
          className={linkClasses}
          disabled={retrying}
          onClick={() => void retryArchive()}
        >
          {archive.archiveStatus === "failed" ? "Arkistoi uudelleen" : "Arkistoi sivu"}
        </button>
      )}
      {canOpenText && (
        <button type="button" className={linkClasses} onClick={() => setDialogOpen(true)}>
          {archive.hasArchivedText ? "Näytä / muokkaa" : "Lisää teksti käsin"}
        </button>
      )}
      {archive.hasArchivedText && (
        <a
          href={`/api/admin/submissions/${archive.submissionId}/archive/text?download=1`}
          className={linkClasses}
        >
          Lataa
        </a>
      )}
      <ArchiveTextDialog
        archive={archive}
        url={url}
        listQueryKeys={listQueryKeys}
        processed={processed}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
