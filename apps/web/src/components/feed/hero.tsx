import { formatCount } from "../../lib/format.js";

/** The running total of recorded waste — the site's centerpiece. */
export function Hero({ total }: { total: number }) {
  return (
    <section className="border-b border-hairline">
      <div className="mx-auto flex max-w-[1240px] flex-col-reverse items-center justify-center gap-6.5 px-4 pt-10 pb-8 md:flex-row md:gap-14 md:px-12 md:pt-15 md:pb-11.5">
        <div className="max-w-[620px] text-center md:text-left">
          <p className="mb-3.5 text-[13px] font-medium tracking-[0.12em] text-muted uppercase">
            Turhaa julkista rahankäyttöä kirjattu tähän mennessä
          </p>
          <p className="font-display text-[40px]/none font-bold tracking-[-0.03em] tabular md:text-[76px]/none">
            {formatCount(total)}&nbsp;<span className="text-accent">€</span>
          </p>
          <p className="mt-4 text-base/normal text-body">
            Kansalaisten ilmoittamia, tekoälyn tiivistämiä ja toimituksen tarkistamia rahareikiä.
            Koska rahaa on — kysymys on mihin.
          </p>
        </div>
        <FlipChart />
      </div>
    </section>
  );
}

/** Decorative easel holding the slogan — the brand mark drawn in CSS. */
function FlipChart() {
  return (
    <div aria-hidden className="relative size-[210px] flex-none md:h-[290px] md:w-[300px]">
      <div className="absolute bottom-0 left-[14%] h-[34%] w-[3px] origin-top rotate-[9deg] bg-easel" />
      <div className="absolute right-[14%] bottom-0 h-[34%] w-[3px] origin-top rotate-[-9deg] bg-easel" />
      <div className="absolute inset-x-[8%] top-0 flex h-[68%] items-center justify-center rounded-[2px] border border-easel-hairline bg-surface shadow-[0_10px_24px_rgba(25,24,23,0.09)]">
        <div className="absolute inset-x-0 top-[-9px] flex justify-center gap-[22%]">
          <div className="h-3.5 w-[26px] rounded-[3px] bg-body" />
          <div className="h-3.5 w-[26px] rounded-[3px] bg-body" />
        </div>
        <p className="max-w-full -rotate-3 px-[12%] text-center font-hand text-[40px]/[0.95] font-bold whitespace-nowrap text-accent md:text-[56px]/[0.95]">
          rahaa&nbsp;on
        </p>
        <div className="absolute inset-x-[12%] bottom-[9%] h-0.5 bg-easel-line" />
      </div>
      <div className="absolute inset-x-[24%] bottom-0 h-[3px] rounded-[2px] bg-easel" />
    </div>
  );
}
