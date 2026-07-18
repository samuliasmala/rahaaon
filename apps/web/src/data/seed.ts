import type { QueueItem, WasteItem } from "../lib/types.js";

/**
 * Demo content from the design prototype. Article URLs are illustrative — the
 * stories are fictional. Replaced by the API once the backend exists.
 */

export const seedItems: WasteItem[] = [
  {
    id: 1,
    title: "IT-järjestelmä myöhässä neljä vuotta — hinta ehti kolminkertaistua",
    amount: 62_000_000,
    entity: "Valtio",
    category: "IT-hankkeet",
    source: "Helsingin Sanomat",
    url: "https://www.hs.fi/politiikka/it-jarjestelma-myohassa",
    days: 2,
    votes: 1204,
    hidden: false,
    summary:
      "Alkuperäinen budjetti oli 21 M€ ja valmistumisarvio on siirtynyt kolmesti. Järjestelmää " +
      'käyttää tällä hetkellä 14 henkilöä. Vanha järjestelmä pidetään rinnalla käynnissä "varmuuden ' +
      'vuoksi", mikä maksaa 2 M€ vuodessa.',
    quote: "Hankejohtajan mukaan aikataulu on nyt realistinen, kuten se on ollut joka vuosi.",
  },
  {
    id: 2,
    title: "Lämmitetty pyörätie, jota ei koskaan kytketty päälle",
    amount: 1_200_000,
    entity: "Oulu",
    category: "Rakentaminen",
    source: "Kaleva",
    url: "https://www.kaleva.fi/lammitetty-pyoratie-oulu",
    days: 3,
    votes: 892,
    hidden: false,
    summary:
      "Lämmityskaapelit asennettiin 2023, mutta sähköliittymä jäi tilaamatta. Talvikunnossapito on " +
      "hoidettu auraamalla lämmitetyn osuuden päältä. Kaupunki selvittää, kenen vastuulla liittymän " +
      "tilaaminen oli.",
    quote: "Kaapelit ovat siellä hyvässä tallessa, totesi yhdyskuntatekniikan päällikkö.",
  },
  {
    id: 3,
    title: "Konsulttiselvitys konsulttien käytön vähentämisestä",
    amount: 240_000,
    entity: "Valtio",
    category: "Konsultit",
    source: "Iltalehti",
    url: "https://www.iltalehti.fi/politiikka/konsulttiselvitys",
    days: 5,
    votes: 2041,
    hidden: false,
    summary:
      "Selvityksen keskeinen suositus oli teettää jatkoselvitys. Jatkoselvityksen kilpailutus on " +
      "parhaillaan käynnissä, ja siihen on varattu 180 000 €.",
    quote: "Ulkopuolinen näkemys oli välttämätön, ministeriöstä perustellaan.",
  },
  {
    id: 4,
    title: "Taidepenkki, jolla ei taiteilijan mukaan ole tarkoituskaan istua",
    amount: 40_000,
    entity: "Tampere",
    category: "Kulttuuri",
    source: "Aamulehti",
    url: "https://www.aamulehti.fi/kulttuuri/taidepenkki",
    days: 7,
    votes: 655,
    hidden: false,
    summary:
      "Teos kommentoi istumista yhteiskunnallisena ilmiönä. Kaupunki hankki lisäksi kyltin " +
      '"Ei saa istua" sekä huoltosopimuksen, joka kattaa istumisen jälkien poistamisen.',
    quote: "Penkki kysyy, kuka saa levätä, kuvailee teoksen tekijä.",
  },
  {
    id: 5,
    title: "Kunnan uusi logo muistuttaa erehdyttävästi edellistä",
    amount: 18_000,
    entity: "Kouvola",
    category: "Viestintä",
    source: "Kouvolan Sanomat",
    url: "https://www.kouvolansanomat.fi/paikalliset/logouudistus",
    days: 8,
    votes: 448,
    hidden: false,
    summary:
      "Uudistuksessa kirjasin vaihtui ja väri pysyi samana. Asukaskyselyssä 71 % vastaajista ei " +
      "huomannut eroa. Brändiuudistuksen jalkautus jatkuu vuoteen 2027.",
    quote: "Muutos on hienovarainen mutta merkityksellinen, kertoo viestintäjohtaja.",
  },
  {
    id: 6,
    title: "Virkamiesdelegaation benchmarking-matka Dubaihin lumiosaamisen perässä",
    amount: 74_000,
    entity: "Valtio",
    category: "Matkustus",
    source: "Yle",
    url: "https://yle.fi/a/benchmarking-matka-dubai",
    days: 11,
    votes: 1310,
    hidden: false,
    summary:
      "Kahdeksan hengen delegaatio tutustui Dubain sisälaskettelukeskuksen lumetusjärjestelmään. " +
      "Matkaraportti on kaksi sivua, joista toinen on kansilehti.",
    quote: "Lumiolosuhteiden ymmärrys syveni merkittävästi, raportissa todetaan.",
  },
  {
    id: 7,
    title: "Sote-kirjaamisjärjestelmän lisenssit, joita kukaan ei käyttänyt",
    amount: 14_300_000,
    entity: "Hyvinvointialue",
    category: "IT-hankkeet",
    source: "Yle",
    url: "https://yle.fi/a/sote-lisenssit",
    days: 14,
    votes: 977,
    hidden: false,
    summary:
      "Lisenssejä hankittiin 12 000 käyttäjälle. Käyttöönotto peruuntui, mutta kolmivuotinen " +
      "sopimus ei sisältänyt irtisanomisehtoa. Lisenssit vanhenevat ensi keväänä.",
    quote: "Sopimus oli sen ajan tietojen valossa perusteltu, arvioi hankintajohtaja.",
  },
  {
    id: 8,
    title: "Silta, joka päättyy peltoon — jatko-osa budjetoitu vuodelle 2031",
    amount: 8_700_000,
    entity: "ELY-keskus",
    category: "Rakentaminen",
    source: "Maaseudun Tulevaisuus",
    url: "https://www.maaseuduntulevaisuus.fi/uutiset/silta-peltoon",
    days: 18,
    votes: 731,
    hidden: false,
    summary:
      "Sillan itäpää valmistui aikataulussa, mutta jatkotien rahoitus siirtyi kehyskaudelle 2031. " +
      'Siihen asti silta toimii paikallisten mukaan "hienona näköalapaikkana".',
    quote: "Kokonaisuus valmistuu kyllä aikanaan, ELY-keskuksesta vakuutetaan.",
  },
];

export const seedQueue: QueueItem[] = [
  {
    id: 101,
    title: "Kaupunki tilasi 400 000 € sovelluksen, jolla on 23 latausta",
    amount: "400000",
    entity: "Espoo",
    category: "IT-hankkeet",
    sourceName: "Länsiväylä",
    url: "https://www.lansivayla.fi/paikalliset/kaupunkisovellus-lataukset",
    confidence: 92,
    received: "2 h sitten",
    summary:
      "Asukassovellus julkaistiin keväällä 2025. Sovelluskaupan mukaan latauksia on 23, joista " +
      "kaupungin viestintäosaston osuus on arviolta 19.",
    aiNote:
      "Summa vahvistettu kahdesta kohdasta artikkelia. Latausmäärä voi olla muuttunut julkaisun " +
      "jälkeen.",
  },
  {
    id: 102,
    title: "Kiertoliittymän taideteos jouduttiin siirtämään — näkyvyyshaitta",
    amount: "260000",
    entity: "Jyväskylä",
    category: "Kulttuuri",
    sourceName: "Keskisuomalainen",
    url: "https://www.ksml.fi/paikalliset/kiertoliittyman-taide-siirto",
    confidence: 81,
    received: "5 h sitten",
    summary:
      "Teos asennettiin kiertoliittymään, jonka jälkeen todettiin sen peittävän näkemäalueen. " +
      "Siirto uuteen paikkaan maksoi 60 000 €, mikä sisältyy summaan.",
    aiNote: "Summa on artikkelin arvio (teos + siirto). Tarkka jakauma ei selviä lähteestä.",
  },
  {
    id: 103,
    title: "Kunnanjohtajien johtamisvalmennus sisälsi alpakkakävelyn",
    amount: "35000",
    entity: "Kuntaliitto",
    category: "Muu",
    sourceName: "Suomen Kuvalehti",
    url: "https://suomenkuvalehti.fi/kotimaa/johtamisvalmennus-alpakat",
    confidence: 64,
    received: "1 pv sitten",
    summary:
      'Kaksipäiväinen valmennus sisälsi työpajoja sekä "läsnäoloharjoituksen alpakkojen kanssa". ' +
      "Osallistujapalaute oli erinomainen.",
    aiNote:
      "Matala varmuus: summa mainitaan vain otsikossa eikä sitä eritellä. Suosittelen " +
      "tarkistamaan lähteen.",
  },
];
