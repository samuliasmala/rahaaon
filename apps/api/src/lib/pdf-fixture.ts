import { Buffer } from "node:buffer";

/**
 * A hand-built PDF writer for tests — no binary fixtures in the repo, and
 * every input the converter reads (baseline, font size, font resource, text
 * width) is set explicitly by the test that needs it. Used by
 * lib/pdf-markdown.test.ts and archive.int.test.ts; never imported by the app.
 *
 * Emits the smallest structure pdf.js accepts without falling back to its
 * damaged-file recovery: catalog, page tree, an Info dictionary, the two
 * standard Helvetica fonts (whose widths pdf.js knows built-in, so text
 * measures realistically), one content stream per page, and a real xref table.
 * Text is written one byte per character in WinAnsi, so fixture strings must
 * stay inside that encoding: Finnish letters are fine (ä = U+00E4), and a glyph
 * Windows put in the C1 range is written as that byte's code point: "\u0095" is
 * a bullet, "\u0096" an en dash.
 */

/** Origin is bottom-left, so a larger `y` is higher up the page. */
export interface FixtureLine {
  text: string;
  y: number;
  /** Left edge; the default is a normal body margin. */
  x?: number;
  /** Font size in points; the default is body text. */
  size?: number;
  /** "bold" gives the line a font resource of its own, as a heading has. */
  font?: "regular" | "bold";
}

export interface FixtureMeta {
  title?: string;
  subject?: string;
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

const escapeText = (text: string): string => text.replace(/([\\()])/g, "\\$1");

function contentStream(lines: FixtureLine[]): string {
  return lines
    .map(({ text, x = 74, y, size = 11, font = "regular" }) => {
      const resource = font === "bold" ? "/F2" : "/F1";
      return `BT ${resource} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escapeText(text)}) Tj ET`;
    })
    .join("\n");
}

/** Serialize objects (1-indexed by array position) with a matching xref table. */
function assemble(objects: string[], trailer: string): Uint8Array {
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const startxref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} ${trailer} >>\nstartxref\n${startxref}\n%%EOF\n`;
  // One char, one byte — so the offsets recorded above are byte offsets.
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

export function buildPdf(pages: FixtureLine[][], meta: FixtureMeta = {}): Uint8Array {
  // 1 catalog, 2 page tree, 3 info, 4-5 fonts, then a dict + stream per page.
  const firstPageObject = 6;
  const kids = pages.map((_, i) => `${firstPageObject + i * 2} 0 R`).join(" ");
  const info = [
    meta.title === undefined ? "" : `/Title (${escapeText(meta.title)})`,
    meta.subject === undefined ? "" : `/Subject (${escapeText(meta.subject)})`,
  ]
    .filter(Boolean)
    .join(" ");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    `<< ${info} >>`,
    "<< /Type /Font /Subtype /Type1 /Encoding /WinAnsiEncoding /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /Encoding /WinAnsiEncoding /BaseFont /Helvetica-Bold >>",
  ];
  pages.forEach((lines, i) => {
    const contents = contentStream(lines);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents ${firstPageObject + i * 2 + 1} 0 R >>`,
      `<< /Length ${contents.length} >>\nstream\n${contents}\nendstream`,
    );
  });
  return assemble(objects, "/Root 1 0 R /Info 3 0 R");
}
