import { formatCount } from "../../lib/format.js";

/** The running total of recorded waste — the site's centerpiece. */
export function Hero({ total }: { total: number }) {
  return (
    <section className="border-b border-hairline px-4 pt-10 pb-8 text-center md:px-12 md:pt-15 md:pb-11.5">
      <p className="mb-3.5 text-[13px] font-medium tracking-[0.12em] text-muted uppercase">
        Turhaa julkista rahankäyttöä kirjattu tähän mennessä
      </p>
      <p className="font-display text-[40px]/none font-bold tracking-[-0.03em] tabular md:text-[84px]/none">
        {formatCount(total)}&nbsp;<span className="text-accent">€</span>
      </p>
      <p className="mx-auto mt-4 max-w-[560px] text-base/normal text-body">
        Kansalaisten ilmoittamia, tekoälyn tiivistämiä ja toimituksen tarkistamia rahareikiä. Koska
        rahaa on — kysymys on mihin.
      </p>
    </section>
  );
}
