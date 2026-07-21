import { VoteButton } from "./vote-button.js";
import { daysSince, formatAge, formatAmount, formatCount, formatDate } from "../../lib/format.js";
import { copyLink } from "../../lib/share.js";
import { useToggleVote } from "../../lib/votes.js";
import { Button } from "../ui/button.js";
import { Dialog, DialogHeader } from "../ui/dialog.js";
import type { WasteItem } from "../../api/model/index.js";

export function DetailDialog({ item, onClose }: { item: WasteItem | null; onClose: () => void }) {
  const voteMutation = useToggleVote();

  return (
    <Dialog
      open={item !== null}
      onClose={onClose}
      label={item?.title ?? "Juttu"}
      className="max-w-[760px]"
    >
      {item && (
        <>
          <DialogHeader onClose={onClose}>
            <span className="rounded-[5px] bg-accent-wash px-2.5 py-[5px] text-[11px] font-semibold tracking-[0.08em] text-accent uppercase">
              {item.category}
            </span>
          </DialogHeader>
          <div className="flex flex-col gap-5 p-4.5 md:p-8">
            <p className="font-display text-[34px]/none font-bold text-accent tabular md:text-[52px]/none">
              {formatAmount(item)}
            </p>
            <h2 className="text-[21px]/[1.3] font-bold tracking-[-0.01em] md:text-[27px]/[1.25]">
              {item.title}
            </h2>
            <p className="flex flex-wrap items-center gap-2.5 text-[13px] text-muted">
              <span className="font-semibold text-body">{item.entity}</span>
              <span aria-hidden>·</span>
              {/* The article's date (when known) is part of the source citation. */}
              <span>
                Lähde: {item.sourceName}
                {item.articlePublishedAt && ` ${formatDate(item.articlePublishedAt)}`}
              </span>
              <span aria-hidden>·</span>
              <span>lisätty {formatAge(daysSince(item.publishedAt))}</span>
            </p>
            <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface px-5.5 py-5">
              <p className="text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
                Tekoälyn tiivistelmä · toimituksen tarkistama
              </p>
              <p className="text-[15px]/[1.65]">{item.summary}</p>
            </div>
            {item.quote && (
              <blockquote className="border-l-[3px] border-hairline-strong py-1 pl-4.5 font-serif text-[15px]/[1.6] text-body italic">
                &ldquo;{item.quote}&rdquo;
                <span className="font-sans text-[13px] text-muted not-italic">
                  &nbsp;&nbsp;— {item.sourceName}
                </span>
              </blockquote>
            )}
            <div className="flex flex-wrap items-center gap-3 pt-1.5">
              <VoteButton
                voted={item.voted}
                onClick={() => voteMutation.mutate({ id: item.id })}
                className="gap-2 px-5.5 py-3 text-[15px]"
              >
                Tämä on turhaa&nbsp;·&nbsp;
                <span className="tabular">{formatCount(item.votes)}</span>
              </VoteButton>
              <Button variant="outline" size="lg" onClick={() => void copyLink(item.sourceUrl)}>
                Jaa
              </Button>
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-auto text-sm font-semibold text-accent hover:text-accent-deep"
              >
                Lue alkuperäinen juttu →
              </a>
            </div>
          </div>
        </>
      )}
    </Dialog>
  );
}
