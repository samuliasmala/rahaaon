import { useState } from "react";
import { ArchiveTextDialog } from "./archive-text-dialog.js";
import { Pill } from "../ui/pill.js";
import type { ArchiveRef, UrlSubmission } from "../../api/model/index.js";
import type { QueryKey } from "@tanstack/react-query";

const linkClasses = "text-xs font-medium text-accent underline-offset-2 hover:underline";

/** The archive ref a submission row carries inline (queue/item rows get theirs from the API). */
export function submissionArchiveRef(entry: UrlSubmission): ArchiveRef {
  if (!entry.archiveStatus) return null;
  return {
    submissionId: entry.id,
    archiveStatus: entry.archiveStatus,
    hasArchivedText: entry.hasArchivedText,
  };
}

/**
 * The page-archive line under an admin entry (submission, queue card or
 * published item): whether the page could be captured (paywall? unreachable?),
 * a viewer/editor for the stored Markdown (also the way to paste a paywalled
 * article in by hand) and the download link. `compact` drops the note and the
 * all-is-well pill for dense layouts (the published table) — a paywalled or
 * failed capture keeps its pill even there. Renders nothing when archiving
 * never ran (S3 not configured / rows from before the feature / seeded
 * entries with no submission behind them).
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

  if (!archive) return null;

  const pill = {
    pending: { label: "Arkistoidaan…", classes: "bg-wash text-muted" },
    ok: { label: "Sivu arkistoitu", classes: "bg-ok-wash text-ok" },
    paywalled: { label: "Mahdollinen maksumuuri", classes: "bg-warn-wash text-warn" },
    failed: { label: "Sivua ei voitu ladata", classes: "bg-accent-wash text-accent" },
  }[archive.archiveStatus];

  const note = {
    pending: null,
    ok: null,
    paywalled: "Sivusta saatiin vain vähän tekstiä — tarkista lähde itse.",
    failed: processed
      ? "Sivua ei saatu talteen — voit lisätä tekstin käsin."
      : "Sivun lataus yritetään uudelleen käsittelyn yhteydessä.",
  }[archive.archiveStatus];

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 pt-1">
      {compact && archive.archiveStatus === "ok" ? (
        <span className="text-xs text-muted">Arkisto:</span>
      ) : (
        <Pill className={pill.classes}>{pill.label}</Pill>
      )}
      {!compact && note && <span className="text-xs text-muted">{note}</span>}
      {archive.archiveStatus !== "pending" && (
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
