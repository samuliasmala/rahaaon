import { VoteButton } from "./vote-button.js";
import { daysSince, formatAge, formatAmount, formatCount, formatDate } from "../../lib/format.js";
import { copyLink } from "../../lib/share.js";
import { useToggleVote } from "../../lib/votes.js";
import { Button } from "../ui/button.js";
import type { WasteItem } from "../../api/model/index.js";

export function ItemRow({ item, onOpen }: { item: WasteItem; onOpen: () => void }) {
  const voteMutation = useToggleVote();

  return (
    <article className="flex animate-in flex-wrap items-center gap-2.5 border-b border-hairline py-6 duration-250 fade-in slide-in-from-bottom-[10px] md:flex-nowrap md:gap-6">
      <p className="w-full flex-none font-display text-2xl font-bold text-accent tabular md:w-[185px] md:text-[28px]">
        {formatAmount(item)}
      </p>
      <button
        type="button"
        onClick={onOpen}
        className="group flex min-w-[min(100%,340px)] flex-1 cursor-pointer flex-col gap-1.5 text-left"
      >
        <span className="text-[19px]/[1.3] font-semibold transition-colors group-hover:text-accent">
          {item.title}
        </span>
        <span className="flex flex-wrap items-center gap-2.5 text-[13px] text-muted">
          <span className="font-semibold text-body">{item.entity}</span>
          <span aria-hidden>·</span>
          <span>{item.category}</span>
          <span aria-hidden>·</span>
          {/* The article's date (when known) is part of the source citation. */}
          <span>
            Lähde: {item.sourceName}
            {item.articlePublishedAt && ` ${formatDate(item.articlePublishedAt)}`}
          </span>
          <span aria-hidden>·</span>
          <span>lisätty {formatAge(daysSince(item.publishedAt))}</span>
        </span>
      </button>
      <div className="flex flex-none gap-2.5">
        <VoteButton
          voted={item.voted}
          onClick={() => voteMutation.mutate({ id: item.id })}
          className="px-3.5 py-2 text-[13px] tabular"
        >
          {formatCount(item.votes)}
        </VoteButton>
        <Button variant="outline" size="sm" onClick={() => void copyLink(item.sourceUrl)}>
          Jaa
        </Button>
      </div>
    </article>
  );
}
