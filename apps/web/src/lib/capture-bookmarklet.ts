/**
 * The "Kaappaa artikkeli" bookmarklet: the editor's way past a paywall the
 * server-side archiver can't read (see the API's article-archive module — a
 * walled page comes back as `paywalled` with nothing but furniture in it).
 * The editor is logged in to the publisher in their own browser, so the article
 * is right there in the DOM; the bookmarklet turns that DOM into the same light
 * Markdown the archive stores, puts it on the clipboard and links to the admin
 * with the article's URL, where one button pastes it into the row's archive.
 *
 * Why a bookmarklet and not a fetch to our API: the publisher's page decides
 * what its scripts may talk to (`connect-src`), and a news site's CSP usually
 * says "not you". Writing to the clipboard needs nobody's permission, so this
 * route works on every site without an extension to install or a subscription
 * cookie to store on the server.
 *
 * ## Self-containment
 *
 * {@link runCapture} and {@link captureArticle} are shipped as *source* —
 * `String(fn)` embedded in the `javascript:` URL — so neither may reference
 * anything outside itself: no imports, no module-level constants, no helpers
 * from this file. Everything they need is either declared inside them or
 * passed as an argument. They are ordinary TypeScript otherwise, so lint,
 * typecheck and the E2E test see the same code the editor's browser runs.
 */

/** What one capture yields: the article's own URL, its title and its text. */
export interface CapturedArticle {
  /** The page's canonical URL — the address the admin looks the submission up by. */
  url: string;
  title: string;
  /** The article as Markdown, in the flavour the archive stores. */
  markdown: string;
}

/**
 * The article in the current DOM, as Markdown. Deliberately a different
 * implementation from the server's HTML converter: here there is a real
 * document, so the content nodes can be selected directly (`p`, `li`,
 * headings, quotes, captions) and the furniture around them — nav, aside,
 * footer, buttons, hidden duplicates of the same paragraph — dropped by
 * looking at each block's ancestry instead of guessing from markup shape.
 *
 * Self-contained: see the module comment.
 */
export function captureArticle(doc: Document): CapturedArticle {
  /** Never carries article text; anything inside one of these is furniture. */
  const SKIP = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEMPLATE",
    "SVG",
    "IFRAME",
    "FORM",
    "NAV",
    "ASIDE",
    "FOOTER",
    "BUTTON",
    "SELECT",
    "VIDEO",
    "AUDIO",
    "CANVAS",
  ]);
  /** The blocks worth keeping — the leaves of these are the article's text. */
  const CONTENT = "h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,pre";

  const tagOf = (el: Element): string => el.tagName.toUpperCase();

  /** Whether an element sits in furniture, or in something hidden from readers. */
  const excluded = (el: Element, root: Element): boolean => {
    for (let node: Element | null = el; node; node = node.parentElement) {
      if (SKIP.has(tagOf(node))) return true;
      if (node.getAttribute("aria-hidden") === "true" || node.hasAttribute("hidden")) return true;
      if (node === root) break;
    }
    return false;
  };

  /** Wrap the text in markers, leaving its surrounding whitespace outside them. */
  const wrap = (text: string, before: string, after: string): string => {
    const lead = /^\s*/.exec(text)![0];
    const tail = /\s*$/.exec(text)![0];
    return lead + before + text.slice(lead.length, text.length - tail.length) + after + tail;
  };

  /** A block's text with links and emphasis kept as Markdown. */
  const inlineText = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as Element;
    const tag = tagOf(el);
    if (SKIP.has(tag)) return "";
    if (el.getAttribute("aria-hidden") === "true" || el.hasAttribute("hidden")) return "";
    if (tag === "BR") return " ";
    let text = "";
    for (const child of el.childNodes) text += inlineText(child);
    if (!text.trim()) return text;
    if (tag === "A") {
      const href = (el as HTMLAnchorElement).href;
      return /^https?:/i.test(href) ? wrap(text, "[", `](${href})`) : text;
    }
    if (tag === "STRONG" || tag === "B") return wrap(text, "**", "**");
    if (tag === "EM" || tag === "I") return wrap(text, "*", "*");
    return text;
  };

  /** Heading level, quote and list markers, from the block's own ancestry. */
  const prefixOf = (el: Element, root: Element): string => {
    const heading = /^H([1-6])$/.exec(tagOf(el));
    if (heading) return `${"#".repeat(Number(heading[1]))} `;
    let quote = "";
    let bullet = "";
    for (let node: Element | null = el; node; node = node.parentElement) {
      const tag = tagOf(node);
      if (tag === "BLOCKQUOTE") quote = "> ";
      // The innermost list wins — the loop walks outwards.
      if (tag === "LI" && !bullet) {
        bullet = node.parentElement && tagOf(node.parentElement) === "OL" ? "1. " : "- ";
      }
      if (node === root) break;
    }
    return quote + bullet;
  };

  /** Length of the paragraph text under an element — the "is this the story?" score. */
  const proseLength = (el: Element): number => {
    let total = 0;
    for (const p of el.querySelectorAll("p")) total += (p.textContent ?? "").trim().length;
    return total;
  };

  // News pages mark the story with <article> (sometimes <main>), but rarely
  // alone — teaser lists and comment blocks wear the same tag — so the
  // candidate with the most paragraph text wins. Without a usable candidate
  // the whole body is converted; the furniture skips above carry that case.
  const body: Element = doc.body ?? doc.documentElement;
  let root = body;
  let bestScore = 0;
  for (const candidate of doc.querySelectorAll("article,main")) {
    const score = proseLength(candidate);
    if (score > bestScore) {
      bestScore = score;
      root = candidate;
    }
  }

  const seen = new Set<string>();
  const blocks: string[] = [];
  for (const el of root.querySelectorAll(CONTENT)) {
    // Leaves only: an <li> wrapping a <p> would otherwise emit the same words
    // twice, once with the bullet and once without.
    if (el.querySelector(CONTENT)) continue;
    if (excluded(el, root)) continue;
    const text = inlineText(el).replace(/\s+/g, " ").trim();
    if (!text) continue;
    const block = prefixOf(el, root) + text;
    // Responsive layouts ship the same paragraph twice (one copy for mobile,
    // one for desktop); the archive needs it once.
    if (seen.has(block)) continue;
    seen.add(block);
    blocks.push(block);
  }

  const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute("content");
  const title = (ogTitle ?? doc.title ?? "").trim();
  // The story element carries the headline as its h1 — but only usually, and
  // the archive reads better when the first line names the article.
  if (title && !blocks.some((block) => block.startsWith("# "))) blocks.unshift(`# ${title}`);

  // The canonical link is what the admin matches the submission by; an absent
  // or empty one leaves the address bar as the best answer.
  const canonical = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  let url = doc.location.href;
  if (canonical?.href) url = canonical.href;
  return { url: url.split("#")[0]!, title, markdown: blocks.join("\n\n") };
}

/**
 * What the bookmarklet actually runs on the publisher's page: extract, copy,
 * and show a small panel with the outcome and a link into the admin. The panel
 * is the only feedback channel available — a bookmarklet has no chrome of its
 * own, and a page that swallows the copy silently would leave the editor
 * pasting yesterday's clipboard.
 *
 * Styling goes through `style.setProperty` (the CSSOM), never a `style`
 * attribute: `style-src` in the page's CSP blocks the attribute but not the
 * property, and the panel has to be legible on a site we don't control.
 *
 * Self-contained: see the module comment. `extract` arrives as an argument
 * because its source is embedded next to this one's.
 */
export function runCapture(
  appOrigin: string,
  extract: (doc: Document) => CapturedArticle,
  panelId: string,
): void {
  const article = extract(document);
  /** Below this the page is probably still walled — say so instead of pretending. */
  const THIN_MARKDOWN = 800;

  const style = (el: HTMLElement, css: Record<string, string>): void => {
    for (const [property, value] of Object.entries(css)) el.style.setProperty(property, value);
  };

  /** Pre-clipboard-API copy: select an off-screen textarea and let the browser copy it. */
  const legacyCopy = (text: string): boolean => {
    const area = document.createElement("textarea");
    area.value = text;
    style(area, { position: "fixed", top: "-1000px", opacity: "0" });
    document.body.append(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    area.remove();
    return copied;
  };

  const copy = (text: string): Promise<boolean> =>
    navigator.clipboard
      ? navigator.clipboard.writeText(text).then(
          () => true,
          () => legacyCopy(text),
        )
      : Promise.resolve(legacyCopy(text));

  // A second click replaces the previous panel instead of stacking one on top
  // of it (the editor re-runs the capture after logging in).
  document.getElementById(panelId)?.remove();

  const panel = document.createElement("div");
  panel.id = panelId;
  style(panel, {
    position: "fixed",
    "z-index": "2147483647",
    right: "16px",
    bottom: "16px",
    width: "320px",
    padding: "14px 16px",
    "border-radius": "12px",
    background: "#141414",
    color: "#ffffff",
    "box-shadow": "0 8px 30px rgba(0,0,0,0.35)",
    font: "500 14px/1.5 system-ui, sans-serif",
    "text-align": "left",
  });

  const heading = document.createElement("div");
  heading.textContent = "Rahaa on — kaappaus";
  style(heading, { "font-weight": "700", "margin-bottom": "6px" });

  const status = document.createElement("div");
  style(status, { color: "#d4d4d4", "margin-bottom": "10px" });
  status.textContent = "Kopioidaan…";

  const open = document.createElement("a");
  open.href = `${appOrigin}/admin?kaappaus=${encodeURIComponent(article.url)}`;
  open.target = "_blank";
  open.rel = "noopener";
  open.textContent = "Avaa Rahaa on ↗";
  style(open, { color: "#ff6b4a", "font-weight": "700", "text-decoration": "none" });

  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Sulje";
  close.addEventListener("click", () => panel.remove());
  style(close, {
    background: "none",
    border: "none",
    color: "#9a9a9a",
    cursor: "pointer",
    font: "inherit",
    "margin-left": "14px",
    padding: "0",
  });

  const actions = document.createElement("div");
  actions.append(open, close);
  panel.append(heading, status, actions);
  document.body.append(panel);

  void copy(article.markdown).then((copied) => {
    const size = `${article.markdown.length} merkkiä`;
    if (!copied) {
      // Neither clipboard route worked (an unfocused document, a browser that
      // wants a gesture we don't have): hand the text over to be copied by hand.
      status.textContent = "Kopiointi ei onnistunut — kopioi teksti käsin (Ctrl/Cmd+C):";
      const area = document.createElement("textarea");
      area.value = article.markdown;
      area.readOnly = true;
      style(area, {
        width: "100%",
        height: "120px",
        margin: "8px 0",
        font: "12px/1.4 ui-monospace, monospace",
      });
      panel.insertBefore(area, actions);
      area.select();
      return;
    }
    status.textContent =
      article.markdown.length < THIN_MARKDOWN
        ? `Kopioitu, mutta tekstiä tuli vähän (${size}). Oletko kirjautunut sisään?`
        : `Artikkeli kopioitu leikepöydälle (${size}).`;
  });
}

/**
 * The bookmarklet's `href`. Percent-encoded because a `javascript:` URL is a
 * URL — the browser decodes it before evaluating, so quotes and spaces in the
 * embedded source survive being pasted into a bookmark. `appOrigin` is baked
 * in at render time: the editor's admin is the one the capture should open.
 */
export function captureBookmarkletHref(appOrigin: string): string {
  const code = `(${String(runCapture)})(${JSON.stringify(appOrigin)},${String(captureArticle)},"rahaaon-capture-panel")`;
  return `javascript:${encodeURIComponent(code)}`;
}
