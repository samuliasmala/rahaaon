import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
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

function AdminPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me } = useQuery(meQueryOptions);
  const { data: submissions = [] } = useGetApiAdminSubmissions();
  const { data: queue = [] } = useGetApiAdminSuggestions();
  const { data: rejectedSuggestions = [] } = useGetApiAdminSuggestionsRejected();
  const { data: rejectedSubmissions = [] } = useGetApiAdminSubmissionsRejected();
  const { data: items = [] } = useGetApiAdminItems();
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
