import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeDb, db, schema as s } from "./client.js";
import { auth } from "../auth/auth.js";
import { env } from "../config/env.js";
import type { AmountType, Category } from "./schema/content.js";

/**
 * Deterministic demo content (from the design prototype — the stories are
 * fictional, URLs illustrative) plus the editorial login. Re-runnable: wipes
 * content tables and the admin user first.
 */

const ADMIN_EMAIL = "toimitus@rahaaon.fi";
const ADMIN_NAME = "Toimitus";
const ADMIN_PASSWORD = env.SEED_ADMIN_PASSWORD ?? "rahaaon-dev";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** YYYY-MM-DD for an epoch moment — the seeds' article publication dates. */
function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

interface SeedItem {
  title: string;
  amountEur: number;
  entity: string;
  category: Category;
  sourceName: string;
  sourceUrl: string;
  daysAgo: number;
  votes: number;
  summary: string;
  quote: string;
}

const ITEMS: SeedItem[] = [
  {
    title: "IT-järjestelmä myöhässä neljä vuotta — hinta ehti kolminkertaistua",
    amountEur: 62_000_000,
    entity: "Valtio",
    category: "IT-hankkeet",
    sourceName: "Helsingin Sanomat",
    sourceUrl: "https://www.hs.fi/politiikka/it-jarjestelma-myohassa",
    daysAgo: 2,
    votes: 1204,
    summary:
      "Alkuperäinen budjetti oli 21 M€ ja valmistumisarvio on siirtynyt kolmesti. Järjestelmää " +
      'käyttää tällä hetkellä 14 henkilöä. Vanha järjestelmä pidetään rinnalla käynnissä "varmuuden ' +
      'vuoksi", mikä maksaa 2 M€ vuodessa.',
    quote: "Hankejohtajan mukaan aikataulu on nyt realistinen, kuten se on ollut joka vuosi.",
  },
  {
    title: "Lämmitetty pyörätie, jota ei koskaan kytketty päälle",
    amountEur: 1_200_000,
    entity: "Oulu",
    category: "Rakentaminen",
    sourceName: "Kaleva",
    sourceUrl: "https://www.kaleva.fi/lammitetty-pyoratie-oulu",
    daysAgo: 3,
    votes: 892,
    summary:
      "Lämmityskaapelit asennettiin 2023, mutta sähköliittymä jäi tilaamatta. Talvikunnossapito on " +
      "hoidettu auraamalla lämmitetyn osuuden päältä. Kaupunki selvittää, kenen vastuulla liittymän " +
      "tilaaminen oli.",
    quote: "Kaapelit ovat siellä hyvässä tallessa, totesi yhdyskuntatekniikan päällikkö.",
  },
  {
    title: "Konsulttiselvitys konsulttien käytön vähentämisestä",
    amountEur: 240_000,
    entity: "Valtio",
    category: "Konsultit",
    sourceName: "Iltalehti",
    sourceUrl: "https://www.iltalehti.fi/politiikka/konsulttiselvitys",
    daysAgo: 5,
    votes: 2041,
    summary:
      "Selvityksen keskeinen suositus oli teettää jatkoselvitys. Jatkoselvityksen kilpailutus on " +
      "parhaillaan käynnissä, ja siihen on varattu 180 000 €.",
    quote: "Ulkopuolinen näkemys oli välttämätön, ministeriöstä perustellaan.",
  },
  {
    title: "Taidepenkki, jolla ei taiteilijan mukaan ole tarkoituskaan istua",
    amountEur: 40_000,
    entity: "Tampere",
    category: "Kulttuuri",
    sourceName: "Aamulehti",
    sourceUrl: "https://www.aamulehti.fi/kulttuuri/taidepenkki",
    daysAgo: 7,
    votes: 655,
    summary:
      "Teos kommentoi istumista yhteiskunnallisena ilmiönä. Kaupunki hankki lisäksi kyltin " +
      '"Ei saa istua" sekä huoltosopimuksen, joka kattaa istumisen jälkien poistamisen.',
    quote: "Penkki kysyy, kuka saa levätä, kuvailee teoksen tekijä.",
  },
  {
    title: "Kunnan uusi logo muistuttaa erehdyttävästi edellistä",
    amountEur: 18_000,
    entity: "Kouvola",
    category: "Viestintä",
    sourceName: "Kouvolan Sanomat",
    sourceUrl: "https://www.kouvolansanomat.fi/paikalliset/logouudistus",
    daysAgo: 8,
    votes: 448,
    summary:
      "Uudistuksessa kirjasin vaihtui ja väri pysyi samana. Asukaskyselyssä 71 % vastaajista ei " +
      "huomannut eroa. Brändiuudistuksen jalkautus jatkuu vuoteen 2027.",
    quote: "Muutos on hienovarainen mutta merkityksellinen, kertoo viestintäjohtaja.",
  },
  {
    title: "Virkamiesdelegaation benchmarking-matka Dubaihin lumiosaamisen perässä",
    amountEur: 74_000,
    entity: "Valtio",
    category: "Matkustus",
    sourceName: "Yle",
    sourceUrl: "https://yle.fi/a/benchmarking-matka-dubai",
    daysAgo: 11,
    votes: 1310,
    summary:
      "Kahdeksan hengen delegaatio tutustui Dubain sisälaskettelukeskuksen lumetusjärjestelmään. " +
      "Matkaraportti on kaksi sivua, joista toinen on kansilehti.",
    quote: "Lumiolosuhteiden ymmärrys syveni merkittävästi, raportissa todetaan.",
  },
  {
    title: "Sote-kirjaamisjärjestelmän lisenssit, joita kukaan ei käyttänyt",
    amountEur: 14_300_000,
    entity: "Hyvinvointialue",
    category: "IT-hankkeet",
    sourceName: "Yle",
    sourceUrl: "https://yle.fi/a/sote-lisenssit",
    daysAgo: 14,
    votes: 977,
    summary:
      "Lisenssejä hankittiin 12 000 käyttäjälle. Käyttöönotto peruuntui, mutta kolmivuotinen " +
      "sopimus ei sisältänyt irtisanomisehtoa. Lisenssit vanhenevat ensi keväänä.",
    quote: "Sopimus oli sen ajan tietojen valossa perusteltu, arvioi hankintajohtaja.",
  },
  {
    title: "Silta, joka päättyy peltoon — jatko-osa budjetoitu vuodelle 2031",
    amountEur: 8_700_000,
    entity: "ELY-keskus",
    category: "Rakentaminen",
    sourceName: "Maaseudun Tulevaisuus",
    sourceUrl: "https://www.maaseuduntulevaisuus.fi/uutiset/silta-peltoon",
    daysAgo: 18,
    votes: 731,
    summary:
      "Sillan itäpää valmistui aikataulussa, mutta jatkotien rahoitus siirtyi kehyskaudelle 2031. " +
      'Siihen asti silta toimii paikallisten mukaan "hienona näköalapaikkana".',
    quote: "Kokonaisuus valmistuu kyllä aikanaan, ELY-keskuksesta vakuutetaan.",
  },
];

interface SeedSuggestion {
  url: string;
  title: string;
  amountEur: number;
  /** Omitted = "exact" (the DB default). */
  amountType?: AmountType;
  amountMaxEur?: number;
  entity: string;
  category: Category;
  sourceName: string;
  hoursAgo: number;
  confidence: number;
  summary: string;
  quote: string;
  aiNote: string;
}

const SUGGESTIONS: SeedSuggestion[] = [
  {
    title: "Kaupunki tilasi 400 000 € sovelluksen, jolla on 23 latausta",
    amountEur: 400_000,
    entity: "Espoo",
    category: "IT-hankkeet",
    sourceName: "Länsiväylä",
    url: "https://www.lansivayla.fi/paikalliset/kaupunkisovellus-lataukset",
    confidence: 92,
    hoursAgo: 2,
    summary:
      "Asukassovellus julkaistiin keväällä 2025. Sovelluskaupan mukaan latauksia on 23, joista " +
      "kaupungin viestintäosaston osuus on arviolta 19.",
    quote: "Sovellus on strateginen avaus, jonka arvo ei mittaudu latauksissa, kaupunki vastaa.",
    aiNote:
      "Summa vahvistettu kahdesta kohdasta artikkelia. Latausmäärä voi olla muuttunut julkaisun " +
      "jälkeen.",
  },
  {
    title: "Kiertoliittymän taideteos jouduttiin siirtämään — näkyvyyshaitta",
    amountEur: 260_000,
    amountType: "approx",
    entity: "Jyväskylä",
    category: "Kulttuuri",
    sourceName: "Keskisuomalainen",
    url: "https://www.ksml.fi/paikalliset/kiertoliittyman-taide-siirto",
    confidence: 81,
    hoursAgo: 5,
    summary:
      "Teos asennettiin kiertoliittymään, jonka jälkeen todettiin sen peittävän näkemäalueen. " +
      "Siirto uuteen paikkaan maksoi 60 000 €, mikä sisältyy summaan.",
    quote: "Näkemäalue tarkistettiin, mutta teoksen jalusta yllätti, myöntää kaupungininsinööri.",
    aiNote: "Summa on artikkelin arvio (teos + siirto). Tarkka jakauma ei selviä lähteestä.",
  },
  {
    title: "Kunnanjohtajien johtamisvalmennus sisälsi alpakkakävelyn",
    amountEur: 35_000,
    entity: "Kuntaliitto",
    category: "Muu",
    sourceName: "Suomen Kuvalehti",
    url: "https://suomenkuvalehti.fi/kotimaa/johtamisvalmennus-alpakat",
    confidence: 64,
    hoursAgo: 24,
    summary:
      'Kaksipäiväinen valmennus sisälsi työpajoja sekä "läsnäoloharjoituksen alpakkojen kanssa". ' +
      "Osallistujapalaute oli erinomainen.",
    quote: "Alpakka ei arvota johtajaa, ja juuri se on harjoituksen ydin, kertoo valmentaja.",
    aiNote:
      "Matala varmuus: summa mainitaan vain otsikossa eikä sitä eritellä. Suosittelen " +
      "tarkistamaan lähteen.",
  },
];

/** One archived rejection so the admin "Hylätyt" tab has content in demos. */
const REJECTED: SeedSuggestion & { rejectedHoursAgo: number } = {
  title: "Kaupunginjohtajan virka-auto vaihdettiin sähköiseen — latausasema unohtui",
  amountEur: 92_000,
  entity: "Pori",
  category: "Muu",
  sourceName: "Satakunnan Kansa",
  url: "https://www.satakunnankansa.fi/paikalliset/virka-auto-lataus",
  confidence: 45,
  hoursAgo: 48,
  rejectedHoursAgo: 30,
  summary:
    "Auto on ladattu naapurikunnan huoltoasemalla. Artikkelin mukaan latausasema on tilattu, " +
    "mutta toimitusaika on 8 kuukautta.",
  quote: "Lataaminen naapurikunnassa on väliaikaisratkaisu, kaupungilta vakuutetaan.",
  aiNote: "Matala varmuus: kulu voi olla normaali hankinta. Summa sisältää auton hinnan.",
};

interface SeedSubmission {
  url: string;
  title: string;
  description: string;
  siteName: string;
  hoursAgo: number;
}

const SUBMISSIONS: SeedSubmission[] = [
  {
    url: "https://www.hs.fi/kaupunki/valoinstallaatio-sammutettu",
    title: "Asematunnelin valoinstallaatio on ollut sammuksissa puoli vuotta",
    description:
      "Kaupungin 120 000 euron valoteos pimeni takuuriidan vuoksi. Korjausaikataulusta ei ole tietoa.",
    siteName: "hs.fi",
    hoursAgo: 1,
  },
  {
    url: "https://yle.fi/a/kunta-osti-drooneja",
    title: "Kunta osti kymmenen droonia — lupia lentämiseen ei haettu",
    description: "Droonit ovat odottaneet varastossa kaksi vuotta ilmailulupien puuttuessa.",
    siteName: "yle.fi",
    hoursAgo: 7,
  },
];

/** One archived link rejection for the merged "Hylätyt" tab. */
const REJECTED_SUBMISSION: SeedSubmission & { rejectedHoursAgo: number } = {
  url: "https://esimerkki.blogspot.fi.invalid/mielipide-verot",
  title: "MIELIPIDE: Kaikki verorahat menevät hukkaan!!",
  description: "Nimettömän kirjoittajan blogimerkintä ilman lähteitä.",
  siteName: "esimerkki.blogspot.fi.invalid",
  hoursAgo: 12,
  rejectedHoursAgo: 10,
};

async function main() {
  console.log("[seed] wiping content tables…");
  await db.delete(s.itemVote);
  await db.delete(s.urlSubmission);
  await db.delete(s.suggestion);
  await db.delete(s.wasteItem);
  await db.delete(s.user).where(eq(s.user.email, ADMIN_EMAIL));

  console.log("[seed] inserting items…");
  const now = Date.now();
  for (const item of ITEMS) {
    const [row] = await db
      .insert(s.wasteItem)
      .values({
        title: item.title,
        amountEur: item.amountEur,
        entity: item.entity,
        category: item.category,
        sourceName: item.sourceName,
        sourceUrl: item.sourceUrl,
        summary: item.summary,
        quote: item.quote,
        publishedAt: new Date(now - item.daysAgo * DAY_MS),
        // The fictional article ran the day before the item hit the feed.
        articlePublishedAt: isoDate(now - (item.daysAgo + 1) * DAY_MS),
      })
      .returning({ id: s.wasteItem.id });

    // One vote row per synthetic visitor — the count is never denormalized.
    const votes = Array.from({ length: item.votes }, () => ({
      itemId: row!.id,
      voterId: randomUUID(),
    }));
    for (let i = 0; i < votes.length; i += 1000) {
      await db.insert(s.itemVote).values(votes.slice(i, i + 1000));
    }
  }

  console.log("[seed] inserting pending suggestions…");
  await db.insert(s.suggestion).values(
    SUGGESTIONS.map((sg) => ({
      url: sg.url,
      title: sg.title,
      amountEur: sg.amountEur,
      amountType: sg.amountType,
      amountMaxEur: sg.amountMaxEur,
      entity: sg.entity,
      category: sg.category,
      sourceName: sg.sourceName,
      summary: sg.summary,
      quote: sg.quote,
      aiNote: sg.aiNote,
      confidence: sg.confidence,
      articlePublishedAt: isoDate(now - sg.hoursAgo * HOUR_MS - DAY_MS),
      createdAt: new Date(now - sg.hoursAgo * HOUR_MS),
    })),
  );

  await db.insert(s.suggestion).values({
    url: REJECTED.url,
    title: REJECTED.title,
    amountEur: REJECTED.amountEur,
    entity: REJECTED.entity,
    category: REJECTED.category,
    sourceName: REJECTED.sourceName,
    summary: REJECTED.summary,
    quote: REJECTED.quote,
    aiNote: REJECTED.aiNote,
    confidence: REJECTED.confidence,
    status: "rejected",
    createdAt: new Date(now - REJECTED.hoursAgo * HOUR_MS),
    reviewedAt: new Date(now - REJECTED.rejectedHoursAgo * HOUR_MS),
  });

  console.log("[seed] inserting url submissions…");
  await db.insert(s.urlSubmission).values(
    SUBMISSIONS.map((sub) => ({
      url: sub.url,
      title: sub.title,
      description: sub.description,
      siteName: sub.siteName,
      createdAt: new Date(now - sub.hoursAgo * HOUR_MS),
    })),
  );
  await db.insert(s.urlSubmission).values({
    url: REJECTED_SUBMISSION.url,
    title: REJECTED_SUBMISSION.title,
    description: REJECTED_SUBMISSION.description,
    siteName: REJECTED_SUBMISSION.siteName,
    status: "rejected",
    createdAt: new Date(now - REJECTED_SUBMISSION.hoursAgo * HOUR_MS),
    processedAt: new Date(now - REJECTED_SUBMISSION.rejectedHoursAgo * HOUR_MS),
  });

  console.log("[seed] creating editorial user…");
  // Public sign-up is disabled, so go through better-auth's internal adapter —
  // it hashes the password the same way the sign-in endpoint verifies it.
  const ctx = await auth.$context;
  const passwordHash = await ctx.password.hash(ADMIN_PASSWORD);
  const adminUser = await ctx.internalAdapter.createUser({
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    emailVerified: true,
  });
  await ctx.internalAdapter.linkAccount({
    userId: adminUser.id,
    providerId: "credential",
    accountId: adminUser.id,
    password: passwordHash,
  });

  console.log("[seed] done:", {
    items: ITEMS.length,
    votes: ITEMS.reduce((n, i) => n + i.votes, 0),
    suggestions: SUGGESTIONS.length,
    submissions: SUBMISSIONS.length,
    rejected: { suggestions: 1, submissions: 1 },
  });
  console.log(`[seed] admin login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
}

main()
  .then(() => closeDb())
  .catch((err: unknown) => {
    console.error("[seed] failed:", err);
    void closeDb().finally(() => process.exit(1));
  });
