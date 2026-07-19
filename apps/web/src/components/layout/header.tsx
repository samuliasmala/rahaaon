import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useGetApiAdminSubmissions, useGetApiAdminSuggestions } from "../../api/admin/admin.js";
import { meQueryOptions } from "../../lib/session.js";
import { useUiStore } from "../../store/ui-store.js";
import { Button } from "../ui/button.js";

export function Header() {
  const openSuggest = useUiStore((s) => s.openSuggest);
  const { data: me } = useQuery(meQueryOptions);
  // The queue badge is editorial-only data; don't even ask when signed out.
  const { data: submissions } = useGetApiAdminSubmissions({
    query: { enabled: Boolean(me) },
  });
  const { data: queue } = useGetApiAdminSuggestions({
    query: { enabled: Boolean(me) },
  });
  // Everything waiting for an editor: raw links + AI-processed suggestions.
  const queueCount = (submissions?.length ?? 0) + (queue?.length ?? 0);

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-hairline bg-paper px-4 py-3.5 md:px-12">
      <Link to="/" className="font-display text-[22px] font-bold tracking-[-0.02em]">
        rahaa<span className="text-accent">&nbsp;on.</span>
      </Link>
      <nav className="flex items-center gap-3.5 text-sm font-medium whitespace-nowrap text-body md:gap-6.5">
        <Link to="/" className="hidden transition-colors hover:text-ink md:inline">
          Selaa
        </Link>
        {/* Placeholder — the about page doesn't exist yet (matches the prototype). */}
        <button
          type="button"
          className="hidden cursor-pointer transition-colors hover:text-ink md:inline"
        >
          Tietoa
        </button>
        <Link
          to="/admin"
          className="flex items-center gap-1.5 text-muted transition-colors hover:text-ink"
        >
          Ylläpito
          {queueCount > 0 && (
            <span className="rounded-full bg-accent px-[7px] py-0.5 text-[11px] font-bold text-white tabular">
              {queueCount}
            </span>
          )}
        </Link>
        <Button onClick={openSuggest}>Ehdota kohde</Button>
      </nav>
    </header>
  );
}
