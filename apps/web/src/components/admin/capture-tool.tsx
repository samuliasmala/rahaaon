import { useEffect, useRef } from "react";
import { captureBookmarkletHref } from "../../lib/capture-bookmarklet.js";

/**
 * How the editor installs the capture bookmarklet (lib/capture-bookmarklet.ts)
 * — the way past a paywall the server-side archiver can't read. Folded away by
 * default: it is a one-time setup, not a daily action.
 *
 * The bookmarklet points at whatever origin the admin is being used from, so
 * the copy the editor drags out of the production admin opens the production
 * admin, and a locally dragged one stays local.
 */
export function CaptureTool() {
  const linkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    // React refuses to render a `javascript:` href — it is an XSS vector
    // anywhere it isn't this — so the bookmarklet is attached to the element
    // itself. Dragging the link to the bookmarks bar is what installs it.
    linkRef.current?.setAttribute("href", captureBookmarkletHref(window.location.origin));
  }, []);

  return (
    <details className="rounded-[10px] border border-hairline bg-surface px-4.5 py-3.5">
      <summary className="cursor-pointer text-sm font-semibold">
        Maksumuurin takaa: kaappaustyökalu
      </summary>
      <div className="mt-3 flex flex-col gap-2 text-[13px]/[1.6] text-body">
        <p>
          1. Vedä tämä linkki selaimesi kirjanmerkkipalkkiin:{" "}
          {/* This anchor is a thing to drag, not a thing to activate: its href
              is the bookmarklet, attached in the effect above (React refuses to
              render a javascript: href), and clicking it here would just run
              the capture against the admin page. */}
          {/* eslint-disable-next-line jsx-a11y/anchor-is-valid, jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- see above */}
          <a
            ref={linkRef}
            draggable
            onClick={(e) => e.preventDefault()}
            className="font-semibold text-accent underline underline-offset-2"
          >
            Kaappaa artikkeli
          </a>
        </p>
        <p>2. Kirjaudu lehden sivustolle ja avaa artikkeli siellä normaalisti.</p>
        <p>
          3. Klikkaa kirjanmerkkiä. Artikkelin teksti kopioituu leikepöydälle ja ylläpito aukeaa
          oikean ehdotuksen kohdalle — teksti tallentuu arkistoon vasta kun hyväksyt sen.
        </p>
      </div>
    </details>
  );
}
