import { describe, expect, it } from "vitest";

/**
 * Unit tests for the notification copy: what the editor actually reads on their
 * phone. Finnish agrees the noun with the count ("1 kohde" / "3 kohdetta"), and
 * a burst of arrivals names the first few and counts the rest rather than
 * growing a message no notification shade will show.
 */

// env.ts (imported transitively) demands DATABASE_URL at module load; give a
// throwaway value so the pure functions can be tested without a database.
process.env.DATABASE_URL ??= "postgres://unit:unit@localhost:5432/unit";
const { arrivalMessage, reminderMessage } = await import("./queue-notifier.js");

const arrival = (
  title: string,
  siteName = "Testilehti",
  url = "https://example.invalid/juttu",
) => ({
  url,
  title,
  siteName,
});

describe("arrivalMessage", () => {
  it("names a single arrival and reports the queue depth", () => {
    const msg = arrivalMessage([arrival("Kaupunki osti kultaisen kahvinkeittimen")], {
      submissions: 1,
      suggestions: 0,
      total: 1,
    });
    expect(msg.title).toBe("Uusi ehdotus");
    expect(msg.message).toBe(
      "Testilehti: Kaupunki osti kultaisen kahvinkeittimen\nJonossa 1 kohde.",
    );
  });

  it("counts the arrivals in the title and pluralises the queue depth", () => {
    const msg = arrivalMessage([arrival("Eka"), arrival("Toka")], {
      submissions: 2,
      suggestions: 3,
      total: 5,
    });
    expect(msg.title).toBe("2 uutta ehdotusta");
    expect(msg.message).toBe("Testilehti: Eka\nTestilehti: Toka\nJonossa 5 kohdetta.");
  });

  it("lists at most three arrivals and counts the remainder", () => {
    const many = ["Eka", "Toka", "Kolmas", "Neljäs", "Viides"].map((t) => arrival(t));
    const msg = arrivalMessage(many, { submissions: 5, suggestions: 0, total: 5 });
    expect(msg.title).toBe("5 uutta ehdotusta");
    expect(msg.message.split("\n")).toEqual([
      "Testilehti: Eka",
      "Testilehti: Toka",
      "Testilehti: Kolmas",
      "…ja 2 muuta.",
      "Jonossa 5 kohdetta.",
    ]);
  });

  it("says 'muu' for a single unlisted arrival", () => {
    const many = ["Eka", "Toka", "Kolmas", "Neljäs"].map((t) => arrival(t));
    expect(arrivalMessage(many, { submissions: 4, suggestions: 0, total: 4 }).message).toContain(
      "…ja 1 muu.",
    );
  });

  it("falls back to the URL when the page gave up no title, and drops an empty source", () => {
    const msg = arrivalMessage([arrival("", "", "https://example.invalid/nimeton")], {
      submissions: 1,
      suggestions: 0,
      total: 1,
    });
    expect(msg.message).toBe("https://example.invalid/nimeton\nJonossa 1 kohde.");
  });
});

describe("reminderMessage", () => {
  it("splits the badge into its two halves", () => {
    expect(reminderMessage({ submissions: 3, suggestions: 2, total: 5 }).message).toBe(
      "5 kohdetta odottaa käsittelyä: 3 ehdotusta jonossa, 2 AI-tiivistelmää tarkistettavana.",
    );
  });

  it("agrees every noun with its own count", () => {
    expect(reminderMessage({ submissions: 1, suggestions: 0, total: 1 }).message).toBe(
      "1 kohde odottaa käsittelyä: 1 ehdotus jonossa, 0 AI-tiivistelmää tarkistettavana.",
    );
  });
});
