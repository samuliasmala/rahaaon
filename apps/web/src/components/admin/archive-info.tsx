import { useState } from "react";
import { ArchiveTextDialog } from "./archive-text-dialog.js";
import { Pill } from "../ui/pill.js";
import type { UrlSubmission } from "../../api/model/index.js";

const linkClasses = "text-xs font-medium text-accent underline-offset-2 hover:underline";

/**
 * The submit-time page-archive line under a submitted link: whether the page
 * could be captured (paywall? unreachable?), a viewer/editor for the stored
 * Markdown (also the way to paste a paywalled article in by hand) and the
 * download link. Renders nothing for rows where archiving never ran (S3 not
 * configured / rows from before the feature).
 */
export function ArchiveInfo({ entry }: { entry: UrlSubmission }) {
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!entry.archiveStatus) return null;

  const pill = {
    pending: { label: "Arkistoidaan…", classes: "bg-wash text-muted" },
    ok: { label: "Sivu arkistoitu", classes: "bg-ok-wash text-ok" },
    paywalled: { label: "Mahdollinen maksumuuri", classes: "bg-warn-wash text-warn" },
    failed: { label: "Sivua ei voitu ladata", classes: "bg-accent-wash text-accent" },
  }[entry.archiveStatus];

  const note = {
    pending: null,
    ok: null,
    paywalled: "Sivusta saatiin vain vähän tekstiä — tarkista lähde itse.",
    failed: "Sivun lataus yritetään uudelleen käsittelyn yhteydessä.",
  }[entry.archiveStatus];

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 pt-1">
      <Pill className={pill.classes}>{pill.label}</Pill>
      {note && <span className="text-xs text-muted">{note}</span>}
      {entry.archiveStatus !== "pending" && (
        <button type="button" className={linkClasses} onClick={() => setDialogOpen(true)}>
          {entry.hasArchivedText ? "Näytä / muokkaa" : "Lisää teksti käsin"}
        </button>
      )}
      {entry.hasArchivedText && (
        <a
          href={`/api/admin/submissions/${entry.id}/archive/text?download=1`}
          className={linkClasses}
        >
          Lataa
        </a>
      )}
      <ArchiveTextDialog entry={entry} open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
