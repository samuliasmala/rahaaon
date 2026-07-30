import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  getGetApiAdminSuggestionsQueryKey,
  useGetApiAdminItems,
  useGetApiAdminSubmissions,
  useGetApiAdminSubmissionsRejected,
  useGetApiAdminSuggestions,
  useGetApiAdminSuggestionsRejected,
} from "../api/admin/admin.js";
import { PublishedTable } from "../components/admin/published-table.js";
import { QueueCard } from "../components/admin/queue-card.js";
import { RejectedCard } from "../components/admin/rejected-card.js";
import { RejectedSubmissionCard } from "../components/admin/rejected-submission-card.js";
import { SubmissionCard } from "../components/admin/submission-card.js";
import { VersionInfo } from "../components/layout/version-info.js";
import { signOut } from "../lib/auth-client.js";
import { cn } from "../lib/cn.js";
import { ensureMe, invalidateMe, meQueryOptions } from "../lib/session.js";

type AdminTab = "submissions" | "queue" | "published" | "rejected";

export const Route = createFileRoute("/admin")({
  beforeLoad: async ({ context }) => {
    const me = await ensureMe(context.queryClient);
    if (!me) throw redirect({ to: "/login" });
  },
  component: AdminPage,
});

/** How often a list refetches while background work (extraction, archiving) runs on it. */
const PROCESSING_POLL_MS = 2500;

function AdminPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me } = useQuery(meQueryOptions);
  // Poll while any entry is being processed or archived in the background, so
  // the queue updates the moment the work finishes — also after a page refresh.
  const { data: submissions = [] } = useGetApiAdminSubmissions({
    query: {
      refetchInterval: (query) =>
        query.state.data?.some((entry) => entry.processing || entry.archiveStatus === "pending")
          ? PROCESSING_POLL_MS
          : false,
    },
  });
  // The remaining lists carry archive pills too; poll them while a re-archive
  // or an AI reprocess kicked off from one of their cards is in flight.
  const { data: queue = [] } = useGetApiAdminSuggestions({
    query: {
      refetchInterval: (query) =>
        query.state.data?.some(
          (entry) => entry.archive?.archiveStatus === "pending" || entry.reprocessing,
        )
          ? PROCESSING_POLL_MS
          : false,
    },
  });

  // When a processing run finishes, the entry either moved to the AI queue or
  // returned to 'new' with an error — refetch the AI queue whenever an id
  // leaves the processing set, so its tab count keeps up. Tracked as an id set
  // (not a count): a finish and a fresh click landing in the same poll delta
  // would leave the count unchanged and hide the transition.
  const processingIds = submissions
    .filter((entry) => entry.processing)
    .map((entry) => entry.id)
    .sort()
    .join(",");
  const prevProcessingIds = useRef("");
  useEffect(() => {
    const current = new Set(processingIds.split(","));
    const finished = prevProcessingIds.current
      .split(",")
      .some((id) => id !== "" && !current.has(id));
    prevProcessingIds.current = processingIds;
    if (finished) {
      void queryClient.invalidateQueries({ queryKey: getGetApiAdminSuggestionsQueryKey() });
    }
  }, [processingIds, queryClient]);
  const { data: rejectedSuggestions = [] } = useGetApiAdminSuggestionsRejected();
  const { data: rejectedSubmissions = [] } = useGetApiAdminSubmissionsRejected({
    query: {
      refetchInterval: (query) =>
        query.state.data?.some((entry) => entry.archiveStatus === "pending")
          ? PROCESSING_POLL_MS
          : false,
    },
  });
  const { data: items = [] } = useGetApiAdminItems({
    query: {
      refetchInterval: (query) =>
        query.state.data?.some(
          (item) => item.archive?.archiveStatus === "pending" || item.reprocessing,
        )
          ? PROCESSING_POLL_MS
          : false,
    },
  });
  const [tab, setTab] = useState<AdminTab>("submissions");

  // One archive for both kinds of rejections, newest first.
  const rejected = [
    ...rejectedSubmissions.map((entry) => ({ kind: "submission" as const, entry })),
    ...rejectedSuggestions.map((entry) => ({ kind: "suggestion" as const, entry })),
  ].sort((a, b) => b.entry.rejectedAt.localeCompare(a.entry.rejectedAt));

  async function handleSignOut() {
    await signOut();
    await invalidateMe(queryClient);
    await navigate({ to: "/" });
  }

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 pt-7 pb-14 md:px-12 md:pt-10 md:pb-16">
      <div className="mb-6.5 flex flex-wrap items-baseline justify-between gap-1.5">
        <h1 className="font-display text-[32px] font-bold tracking-[-0.02em]">Ylläpito</h1>
        <p className="flex items-center gap-3 text-[13px] text-muted">
          Kirjautunut: {me?.user.email}
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="cursor-pointer font-semibold text-body underline-offset-2 hover:underline"
          >
            Kirjaudu ulos
          </button>
        </p>
      </div>

      <div role="tablist" className="mb-6 flex gap-1 border-b border-hairline">
        <TabButton active={tab === "submissions"} onClick={() => setTab("submissions")}>
          Ehdotusjono ({submissions.length})
        </TabButton>
        <TabButton active={tab === "queue"} onClick={() => setTab("queue")}>
          Tekoälyn käsittelemät ({queue.length})
        </TabButton>
        <TabButton active={tab === "published"} onClick={() => setTab("published")}>
          Julkaistut ({items.length})
        </TabButton>
        <TabButton active={tab === "rejected"} onClick={() => setTab("rejected")}>
          Hylätyt ({rejected.length})
        </TabButton>
      </div>

      {tab === "submissions" && (
        <div className="flex flex-col gap-5">
          {submissions.length === 0 && (
            <p className="py-14 text-center text-[15px] text-muted">
              Ei uusia linkkiehdotuksia. ☕
            </p>
          )}
          {submissions.map((entry) => (
            <SubmissionCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}

      {tab === "queue" && (
        <div className="flex flex-col gap-5">
          {queue.length === 0 && (
            <p className="py-14 text-center text-[15px] text-muted">
              Jono on tyhjä. Hyvin seulottu. ☕
            </p>
          )}
          {queue.map((entry) => (
            <QueueCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}

      {tab === "published" && <PublishedTable items={items} />}

      {tab === "rejected" && (
        <div className="flex flex-col gap-5">
          {rejected.length === 0 && (
            <p className="py-14 text-center text-[15px] text-muted">Ei hylättyjä ehdotuksia.</p>
          )}
          {rejected.map((item) =>
            item.kind === "submission" ? (
              <RejectedSubmissionCard key={item.entry.id} entry={item.entry} />
            ) : (
              <RejectedCard key={item.entry.id} entry={item.entry} />
            ),
          )}
        </div>
      )}
      <VersionInfo className="mt-12 text-muted" />
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "-mb-px cursor-pointer border-b-2 px-4.5 py-3 text-sm font-semibold transition-colors",
        active ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
