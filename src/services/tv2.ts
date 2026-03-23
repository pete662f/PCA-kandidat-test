/**
 * TV2 data fetcher — fetches candidate test data from TV2's public endpoints.
 */

import {
  TV2_TEST_URL,
  TV2_BUNDLE_URL,
  TV2_AREA_BUNDLE_URL,
  TV2_SITE_META,
  PARTY_LEADERS_BY_CODE,
} from "../config.ts";
import type {
  Election,
  Question,
  Candidate,
  Municipality,
} from "../types.ts";

function normalizePersonName(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseJsNumber(raw: string): number {
  return Math.trunc(parseFloat(raw.replace("E", "e")));
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

// ── Page props (API endpoint) ──

async function fetchPageProps(): Promise<{ apiEndpoint: string }> {
  const html = await fetchText(TV2_TEST_URL);
  const match = html.match(
    /data-bundle="FVCandidateTest" data-props="([^"]+)"/
  );
  if (!match) throw new Error("Could not find TV2 candidate-test props.");
  const decoded = Buffer.from(match[1], "base64").toString("utf-8");
  return JSON.parse(decoded);
}

// ── Questions from JS bundle ──

async function fetchQuestions(): Promise<Question[]> {
  const bundle = await fetchText(TV2_BUNDLE_URL);
  const match = bundle.match(
    /817:\(e,t\)=>\{.*?var a=\[(.*?)\],n=a\.find/s
  );
  if (!match) throw new Error("Could not extract TV2 questions from bundle.");

  const pattern =
    /\{id:"(?<id>[^"]+)",type:"(?<type>[^"]+)",header:"(?<header>[^"]+)",question:"(?<question>[^"]+)"(?:,depends:\{selectedArea:"(?<selectedArea>[^"]+)"\})?\}/g;

  const questions: Question[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(match[1])) !== null) {
    const g = m.groups!;
    questions.push({
      questionId: g.id,
      topic: g.header,
      question: g.question,
      shortLabel: `${g.header}: ${g.question}`,
    });
  }

  if (!questions.length)
    throw new Error("TV2 question bundle found but no questions parsed.");
  return questions.sort((a, b) => a.questionId.localeCompare(b.questionId));
}

// ── Area metadata from JS bundle ──

interface AreaItem {
  value: number;
  label: string;
}

async function fetchAreaMetadata(): Promise<{
  communes: AreaItem[];
  greaterConstituencies: AreaItem[];
  communeToGreater: Map<number, number>;
}> {
  const bundle = await fetchText(TV2_AREA_BUNDLE_URL);

  const communeMatch = bundle.match(
    /7429:\(e,l\)=>\{.*?l\.communes=\[(.*?)\]\},8580:/s
  );
  const constMatch = bundle.match(
    /r=l\.greaterConstituencies=\[(.*?)\];l\.communeToGreaterConstituency/s
  );
  const mappingMatch = bundle.match(
    /8580:\(e,l\)=>\{.*?var a=\{(.*?)\},r=l\.greaterConstituencies=/s
  );

  if (!communeMatch || !constMatch || !mappingMatch)
    throw new Error("Could not extract TV2 area metadata from bundle.");

  const communes: AreaItem[] = [];
  for (const [, value, label] of communeMatch[1].matchAll(
    /\{value:(\d+),label:"([^"]+)"/g
  )) {
    communes.push({ value: parseInt(value), label });
  }

  const greaterConstituencies: AreaItem[] = [];
  for (const [, value, label] of constMatch[1].matchAll(
    /\{value:(900[0-9e]+),label:"([^"]+)"/g
  )) {
    greaterConstituencies.push({ value: parseJsNumber(value), label });
  }

  const communeToGreater = new Map<number, number>();
  for (const [, commune, greater] of mappingMatch[1].matchAll(
    /(\d+):(900[0-9e]+)/g
  )) {
    communeToGreater.set(parseInt(commune), parseJsNumber(greater));
  }

  if (!communes.length || !greaterConstituencies.length || !communeToGreater.size)
    throw new Error("TV2 area metadata was incomplete.");

  return { communes, greaterConstituencies, communeToGreater };
}

// ── Candidates and answers ──

async function fetchCandidatesAndAnswers(
  apiEndpoint: string,
  questions: Question[],
  greaterConstituencies: AreaItem[]
): Promise<{
  candidates: Candidate[];
  answersWide: Map<number, Map<string, number | null>>;
}> {
  const questionIdSet = new Set(questions.map((q) => q.questionId));
  const greaterLookup = new Map(
    greaterConstituencies.map((g) => [g.value, g.label])
  );

  const candidateMap = new Map<number, Candidate>();
  const answersMap = new Map<number, Map<string, number | null>>();

  for (const [greaterId, greaterName] of greaterLookup) {
    const res = await fetch(
      `${apiEndpoint}/results/candidates/${greaterId}`,
      {
        headers: { "user-agent": "Mozilla/5.0" },
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching candidates for area ${greaterId}`);
    const candidates: any[] = await res.json();

    for (const c of candidates) {
      const candidateId = parseInt(c.id);
      const partyCode = (c.partyLetter ?? "").trim().toUpperCase();

      if (!candidateMap.has(candidateId)) {
        candidateMap.set(candidateId, {
          candidateId,
          name: c.name ?? "",
          partyCode,
          partyName: c.partyName ?? "",
          currentPartyCode: partyCode,
          currentPartyName: c.partyName ?? "",
          bigConstituencyId: greaterId,
          bigConstituencyName: greaterName,
          nominationConstituency: "",
          smallConstituencyCount: 1,
          smallConstituencyNames: greaterName,
          isPartyLeader:
            normalizePersonName(c.name) ===
            normalizePersonName(PARTY_LEADERS_BY_CODE[partyCode]),
          urlKey: c.internalUrl ?? "",
          occupation: c.occupation ?? null,
          partyId: null,
          birthdate: null,
          isIncumbent: null,
        });
      }

      // Parse answers
      const answers = c.answers ?? {};
      if (!answersMap.has(candidateId)) {
        answersMap.set(candidateId, new Map());
      }
      const cAnswers = answersMap.get(candidateId)!;

      for (const [qid, payload] of Object.entries(answers as Record<string, any>)) {
        if (!questionIdSet.has(qid)) continue;
        const answerValue = payload?.answer;
        cAnswers.set(
          qid,
          answerValue === null || answerValue === undefined
            ? null
            : parseFloat(String(answerValue))
        );
      }
    }
  }

  const candidates = Array.from(candidateMap.values()).sort(
    (a, b) =>
      a.bigConstituencyId - b.bigConstituencyId ||
      a.partyCode.localeCompare(b.partyCode) ||
      a.name.localeCompare(b.name)
  );

  return { candidates, answersWide: answersMap };
}

// ── Main entry point ──

export async function fetchTv2Source(): Promise<{
  election: Election;
  siteMeta: typeof TV2_SITE_META;
  municipalities: Municipality[];
  questions: Question[];
  questionConsistency: Array<{
    bigGroupId: number;
    questionCount: number;
    commonQuestionCount: number;
    sameAsCommonSet: boolean;
  }>;
  candidates: Candidate[];
  answersWide: Map<number, Map<string, number | null>>;
}> {
  console.log("[TV2] Fetching page props...");
  const props = await fetchPageProps();

  console.log("[TV2] Fetching questions...");
  const questions = await fetchQuestions();

  console.log("[TV2] Fetching area metadata...");
  const { communes, greaterConstituencies, communeToGreater } =
    await fetchAreaMetadata();

  console.log("[TV2] Fetching candidates and answers...");
  const { candidates, answersWide } = await fetchCandidatesAndAnswers(
    props.apiEndpoint,
    questions,
    greaterConstituencies
  );

  // Build municipality list
  const greaterLookup = new Map(
    greaterConstituencies.map((g) => [g.value, g.label])
  );
  const municipalities: Municipality[] = communes
    .filter((c) => communeToGreater.has(c.value))
    .map((c) => {
      const greaterId = communeToGreater.get(c.value)!;
      const greaterName = greaterLookup.get(greaterId)!;
      return {
        name: c.label,
        kmdId: c.value,
        bigConstituencyName: greaterName,
        smallConstituencies: [greaterName],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "da"));

  const election: Election = {
    id: 0,
    prefix: "FV2026 TV2",
    name: "Folketingsvalg 2026 \u00b7 TV 2 kandidattest",
    valgomatId: 0,
  };

  const questionConsistency = [
    {
      bigGroupId: 0,
      questionCount: questions.length,
      commonQuestionCount: questions.length,
      sameAsCommonSet: true,
    },
  ];

  console.log(
    `[TV2] Done: ${candidates.length} candidates, ${questions.length} questions, ${municipalities.length} municipalities`
  );

  return {
    election,
    siteMeta: TV2_SITE_META,
    municipalities,
    questions,
    questionConsistency,
    candidates,
    answersWide,
  };
}
