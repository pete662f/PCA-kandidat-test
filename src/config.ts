import type { SiteMeta } from "./types.ts";

// ── Altinget API ──

export const API_BASE = "https://api.altinget.dk/vaa-api";
export const ELECTION_ID = 13;
export const VALGOMAT_ID = 15;

// ── TV2 ──

export const TV2_TEST_URL = "https://nyheder.tv2.dk/kandidattest";
export const TV2_BUNDLE_URL =
  "https://web.tv2a.dk/bundles/1620.d5a2c86687ee2de1.js";
export const TV2_AREA_BUNDLE_URL =
  "https://web.tv2a.dk/bundles/8952.d5a2c86687ee2de1.js";

// ── PCA parameters ──

export const MIN_ANSWERED_QUESTIONS = 20;
export const PCA_COMPONENTS = 4;
export const TOP_N_SUMMARY_ROWS = 5;

// ── Answer mapping (Altinget scale → symmetric) ──

export const ANSWER_MAP: Record<number, number> = {
  1: -2.0,
  2: -1.0,
  4: 1.0,
  5: 2.0,
};

// ── Party colors ──

export const PARTY_COLORS: Record<string, string> = {
  A: "#e32f3b",
  B: "#c2185b",
  C: "#0b7a53",
  F: "#5fb336",
  H: "#f28c28",
  I: "#41b6e6",
  M: "#7f56d9",
  O: "#d4a017",
  V: "#1d4ed8",
  "\u00c6": "#214e9c",
  "\u00d8": "#d62828",
  "\u00c5": "#7fbf3f",
  "": "#6b7280",
};

export const PARTY_COLOR_FALLBACK = "#475569";

// ── Party leaders ──

export const PARTY_LEADERS_BY_CODE: Record<string, string> = {
  A: "Mette Frederiksen",
  B: "Martin Lidegaard",
  C: "Mona Juul",
  F: "Pia Olsen Dyhr",
  H: "Lars Boje Mathiesen",
  I: "Alex Vanopslagh",
  M: "Lars L\u00f8kke Rasmussen",
  O: "Morten Messerschmidt",
  V: "Troels Lund Poulsen",
  "\u00c6": "Inger St\u00f8jberg",
  "\u00d8": "Pelle Dragsted",
  "\u00c5": "Franciska Rosenkilde",
};

// ── Municipality → small constituency hints ──

export const MUNICIPALITY_SMALL_CONSTITUENCY_HINTS: Record<number, string[]> = {
  101: ["Østerbro", "Sundbyvester", "Indre By", "Sundbyøster", "Nørrebro", "Bispebjerg", "Brønshøj", "Valby", "Vesterbro"],
  147: ["Falkoner", "Slots"],
  151: ["Ballerup"],
  153: ["Brøndby"],
  155: ["Tårnby"],
  157: ["Gentofte"],
  159: ["Gladsaxe"],
  161: ["Ballerup"],
  163: ["Rødovre"],
  165: ["Taastrup"],
  167: ["Hvidovre"],
  169: ["Taastrup"],
  173: ["Lyngby"],
  175: ["Rødovre"],
  183: ["Brøndby"],
  185: ["Tårnby"],
  187: ["Brøndby"],
  190: ["Egedal"],
  201: ["Rudersdal"],
  210: ["Fredensborg"],
  217: ["Helsingør"],
  219: ["Hillerød"],
  223: ["Fredensborg"],
  230: ["Rudersdal"],
  240: ["Egedal"],
  250: ["Frederikssund"],
  253: ["Greve"],
  259: ["Køge"],
  260: ["Frederikssund"],
  265: ["Roskilde"],
  269: ["Greve"],
  270: ["Hillerød"],
  306: ["Kalundborg"],
  316: ["Holbæk"],
  320: ["Faxe"],
  326: ["Kalundborg"],
  329: ["Ringsted"],
  330: ["Slagelse"],
  336: ["Faxe"],
  340: ["Ringsted"],
  350: ["Køge"],
  360: ["Lolland"],
  370: ["Næstved"],
  376: ["Guldborgsund"],
  390: ["Vordingborg"],
  400: ["Rønne", "Aakirkeby"],
  410: ["Middelfart"],
  411: ["Aakirkeby"],
  420: ["Assens"],
  430: ["Faaborg"],
  440: ["Nyborg"],
  450: ["Nyborg"],
  461: ["Odense Øst", "Odense Vest", "Odense Syd"],
  479: ["Svendborg"],
  480: ["Middelfart"],
  482: ["Svendborg"],
  492: ["Faaborg"],
  510: ["Haderslev"],
  530: ["Vejen"],
  540: ["Sønderborg"],
  550: ["Tønder"],
  561: ["Esbjerg By", "Esbjerg Omegn"],
  563: ["Esbjerg By"],
  573: ["Varde"],
  575: ["Vejen"],
  580: ["Aabenraa"],
  607: ["Fredericia"],
  615: ["Horsens"],
  621: ["Kolding Nord", "Kolding Syd"],
  630: ["Vejle Nord", "Vejle Syd"],
  657: ["Herning Syd", "Herning Nord"],
  661: ["Holstebro"],
  665: ["Struer"],
  671: ["Struer"],
  706: ["Djurs"],
  707: ["Djurs"],
  710: ["Favrskov"],
  727: ["Skanderborg"],
  730: ["Randers Nord", "Randers Syd"],
  740: ["Silkeborg Nord", "Silkeborg Syd"],
  741: ["Skanderborg"],
  746: ["Skanderborg"],
  751: ["Aarhus Syd", "Aarhus Vest", "Aarhus Nord", "Aarhus Øst"],
  756: ["Ikast"],
  760: ["Ringkøbing"],
  766: ["Hedensted"],
  773: ["Thisted"],
  779: ["Skive"],
  787: ["Thisted"],
  791: ["Viborg Vest", "Viborg Øst"],
  810: ["Brønderslev"],
  813: ["Frederikshavn"],
  820: ["Himmerland"],
  825: ["Frederikshavn"],
  840: ["Himmerland"],
  846: ["Mariagerfjord"],
  849: ["Brønderslev"],
  851: ["Aalborg Øst", "Aalborg Vest", "Aalborg Nord"],
  860: ["Hjørring"],
};

// ── Site meta definitions ──

export const ALTINGET_SITE_META: SiteMeta = {
  sourceSlug: "altinget",
  sourceLabel: "Altinget",
  sourceDescription: "Altingets frontend-API",
  sourceAttribution:
    "Kandidatmetadata, områdefiltre og besvarelser er hentet fra samme API som den offentlige kandidattest bruger.",
  uploadHelpHtml:
    'Upload en JSON-fil med svar fra Altinget eller DR. Understøtter både <code>Answers</code>-objekter og DR\'s gemte <code>appStateAnswers</code>/<code>answers</code>-data. Svar kan være <code>1, 2, 4, 5</code> eller de projicerede værdier <code>-2, -1, 1, 2</code>.',
};

export const TV2_SITE_META: SiteMeta = {
  sourceSlug: "tv2",
  sourceLabel: "TV 2",
  sourceDescription:
    "TV 2s offentlige kandidattest-API og statiske spørgmålsmetadata",
  sourceAttribution:
    "Kandidatmetadata og besvarelser er hentet fra TV 2s offentlige kandidattest-endpoints, mens spørgsmål og områdemapping kommer fra den publicerede frontend-bundle.",
  uploadHelpHtml:
    'Upload en JSON-fil med svar fra TV 2. Understøtter både direkte <code>answers</code>-objekter og hele kandidat-/resultatpayloads. Svar kan være <code>-2, -1, 0, 1, 2</code>; <code>0</code> tolkes som neutralt svar.',
};

export const DR_SITE_META: SiteMeta = {
  sourceSlug: "dr",
  sourceLabel: "DR",
  sourceDescription:
    "Altingets kandidatdata med DR-kompatibel upload-/svarmodel",
  sourceAttribution:
    "Kandidatmetadata og kandidatbesvarelser hentes fra Altingets offentlige kandidattest-API, mens uploaden accepterer DR's gemte svarformat.",
  uploadHelpHtml: ALTINGET_SITE_META.uploadHelpHtml,
};

export const PORT = parseInt(process.env.PORT || "3000", 10);
