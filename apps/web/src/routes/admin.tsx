import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PublishedTable } from "../components/admin/published-table.js";
import { QueueCard } from "../components/admin/queue-card.js";
import { cn } from "../lib/cn.js";
import { useAppStore } from "../store/app-store.js";

type AdminTab = "queue" | "published";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

function AdminPage() {
  const queue = useAppStore((s) => s.queue);
  const items = useAppStore((s) => s.items);
  const [tab, setTab] = useState<AdminTab>("queue");

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 pt-7 pb-14 md:px-12 md:pt-10 md:pb-16">
      <div className="mb-6.5 flex flex-wrap items-baseline justify-between gap-1.5">
        <h1 className="font-display text-[32px] font-bold tracking-[-0.02em]">Ylläpito</h1>
        {/* Static until real auth exists — matches the prototype. */}
        <p className="text-[13px] text-muted">Kirjautunut: toimitus@rahaaon.fi</p>
      </div>

      <div role="tablist" className="mb-6 flex gap-1 border-b border-hairline">
        <TabButton active={tab === "queue"} onClick={() => setTab("queue")}>
          Ehdotusjono ({queue.length})
        </TabButton>
        <TabButton active={tab === "published"} onClick={() => setTab("published")}>
          Julkaistut ({items.length})
        </TabButton>
      </div>

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
