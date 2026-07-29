import type { ArchiveRef, UrlSubmission } from "../../api/model/index.js";

/** The archive ref a submission row carries inline (queue/item rows get theirs from the API). */
export function submissionArchiveRef(entry: UrlSubmission): ArchiveRef {
  if (!entry.archiveStatus) return null;
  return {
    submissionId: entry.id,
    archiveStatus: entry.archiveStatus,
    hasArchivedText: entry.hasArchivedText,
  };
}
