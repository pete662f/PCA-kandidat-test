/**
 * Altinget/DR data fetcher — fetches from the Altinget VAA API.
 * Requires ALTINGET_API_KEY environment variable.
 */

import {
  API_BASE,
  ELECTION_ID,
  VALGOMAT_ID,
  ANSWER_MAP,
  ALTINGET_SITE_META,
  DR_SITE_META,
  PARTY_LEADERS_BY_CODE,
  MUNICIPALITY_SMALL_CONSTITUENCY_HINTS,
} from "../config.ts";
import type {
  Election,
  SiteMeta,
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

/** Decode all HTML entities — named (including Danish) and numeric. */
function decodeHtmlEntities(text: string): string {
  // Numeric entities: &#123; and &#x7B;
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
    String.fromCodePoint(parseInt(hex, 16))
  );
  text = text.replace(/&#(\d+);/g, (_, dec) =>
    String.fromCodePoint(parseInt(dec, 10))
  );

  // Named entities — covers all common ones + Danish characters
  const entities: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    // Danish
    aring: "\u00e5", Aring: "\u00c5",
    aelig: "\u00e6", AElig: "\u00c6",
    oslash: "\u00f8", Oslash: "\u00d8",
    // Accented vowels common in Danish text
    eacute: "\u00e9", Eacute: "\u00c9",
    egrave: "\u00e8", Egrave: "\u00c8",
    uuml: "\u00fc", Uuml: "\u00dc",
    ouml: "\u00f6", Ouml: "\u00d6",
    auml: "\u00e4", Auml: "\u00c4",
    // Other common entities
    ndash: "\u2013", mdash: "\u2014",
    lsquo: "\u2018", rsquo: "\u2019",
    ldquo: "\u201c", rdquo: "\u201d",
    bull: "\u2022", hellip: "\u2026",
    copy: "\u00a9", reg: "\u00ae",
    trade: "\u2122", euro: "\u20ac",
    pound: "\u00a3", yen: "\u00a5",
    cent: "\u00a2", sect: "\u00a7",
    deg: "\u00b0", micro: "\u00b5",
    frac12: "\u00bd", frac14: "\u00bc", frac34: "\u00be",
    times: "\u00d7", divide: "\u00f7",
    plusmn: "\u00b1", middot: "\u00b7",
    laquo: "\u00ab", raquo: "\u00bb",
    iexcl: "\u00a1", iquest: "\u00bf",
    // Scandinavian extras
    ntilde: "\u00f1", Ntilde: "\u00d1",
    ccedil: "\u00e7", Ccedil: "\u00c7",
    szlig: "\u00df",
    eth: "\u00f0", ETH: "\u00d0",
    thorn: "\u00fe", THORN: "\u00de",
    acute: "\u00b4", cedil: "\u00b8",
  };

  text = text.replace(/&([a-zA-Z]+);/g, (match, name) =>
    entities[name] ?? match
  );

  return text;
}

function stripHtml(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let text = raw.replace(/<[^>]+>/g, " ");
  text = decodeHtmlEntities(text);
  text = text.replace(/\s+/g, " ").trim();
  return text || null;
}

function getApiKey(): string {
  const key = process.env.ALTINGET_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "Missing ALTINGET_API_KEY. Set it in .env or as an environment variable."
    );
  }
  return key;
}

async function apiGet(
  apiKey: string,
  path: string,
  params?: Record<string, string | number | boolean>
): Promise<any> {
  const url = new URL(`${API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    headers: {
      authorization: apiKey,
      referer: "https://www.altinget.dk/",
      "user-agent": "Mozilla/5.0",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${path}`);
  return res.json();
}

// ── Metadata ──

async function fetchElectionMetadata(apiKey: string): Promise<{
  election: Election;
  bigConstituencies: any[];
  smallConstituencies: any[];
  municipalities: any[];
}> {
  const elections = await apiGet(apiKey, "/v1/GetElections");
  const election = elections.find((e: any) => e.ID === ELECTION_ID);
  if (!election) throw new Error(`Election ${ELECTION_ID} not found`);

  const valgomats = await apiGet(apiKey, "/v1/GetValgomats", {
    electionId: ELECTION_ID,
    frontpage: true,
  });
  const valgomat = valgomats.find((v: any) => v.ID === VALGOMAT_ID);
  if (!valgomat) throw new Error(`Valgomat ${VALGOMAT_ID} not found`);

  const [bigConstituencies, smallConstituencies, municipalities] =
    await Promise.all([
      apiGet(apiKey, "/v1/GetBigConstituencies"),
      apiGet(apiKey, "/v1/GetSmallConstituencies"),
      apiGet(apiKey, "/v1/GetMunicipalities"),
    ]);

  return {
    election: {
      id: election.ID,
      prefix: election.Prefix,
      name: election.Name,
      valgomatId: valgomat.ID,
    },
    bigConstituencies,
    smallConstituencies,
    municipalities,
  };
}

// ── Municipality payload ──

function buildMunicipalityPayload(
  municipalities: any[],
  bigConstituencies: any[],
  smallConstituencies: any[]
): Municipality[] {
  const bigLookup = new Map<number, string>(
    bigConstituencies.map((b: any) => [
      parseInt(b.ID),
      (b.Name ?? "").trim(),
    ])
  );
  const smallNames = smallConstituencies.map((s: any) =>
    (s.Name ?? "").trim()
  );

  const payload: Municipality[] = [];

  for (const muni of [...municipalities].sort((a, b) =>
    ((a.Name ?? "") as string).localeCompare((b.Name ?? "") as string, "da")
  )) {
    const name = (muni.Name ?? "").trim();
    const kmdId = parseInt(muni.ID_KMD ?? "0");
    const shortNames = MUNICIPALITY_SMALL_CONSTITUENCY_HINTS[kmdId];
    if (!shortNames) continue;

    const resolvedSmalls: string[] = [];
    for (const shortName of shortNames) {
      const matches = [
        ...new Set(smallNames.filter((s) => s.includes(shortName))),
      ].sort();
      if (matches.length === 1) {
        resolvedSmalls.push(matches[0]);
      }
    }

    payload.push({
      name,
      kmdId,
      bigConstituencyName:
        bigLookup.get(parseInt(muni.ID_BigConstituency ?? "0")) ?? "",
      smallConstituencies: [
        ...new Set(resolvedSmalls),
      ].sort(),
    });
  }

  return payload;
}

// ── Questions ──

async function fetchQuestions(
  apiKey: string,
  bigGroupId: number
): Promise<any[]> {
  const payload = await apiGet(apiKey, "/v2/GetQuestions", {
    electionId: ELECTION_ID,
    valgomatId: VALGOMAT_ID,
    groupId: bigGroupId,
    frontpage: "true",
  });

  return payload.map((row: any) => ({
    questionId: parseInt(row.Id),
    topic: stripHtml(row.Title),
    question: stripHtml(row.Question),
    elaboration: stripHtml(row.Info),
    argumentFor: stripHtml(row.ArgumentFor),
    argumentAgainst: stripHtml(row.ArgumentAgainst),
    questionType: row.QuestionType,
    isTopicQuestionType: Boolean(row.IsTopicQuestionType),
    bigGroupId,
  }));
}

async function prepareQuestions(
  apiKey: string,
  bigConstituencies: any[]
): Promise<{
  questions: Question[];
  questionConsistency: Array<{
    bigGroupId: number;
    questionCount: number;
    commonQuestionCount: number;
    sameAsCommonSet: boolean;
  }>;
}> {
  const byGroup = new Map<number, any[]>();
  for (const group of bigConstituencies) {
    const id = parseInt(group.ID);
    byGroup.set(id, await fetchQuestions(apiKey, id));
  }

  const questionSets = new Map<number, Set<number>>();
  for (const [gid, rows] of byGroup) {
    questionSets.set(gid, new Set(rows.map((r: any) => r.questionId)));
  }

  const allSets = Array.from(questionSets.values());
  if (!allSets.length) throw new Error("No question sets returned.");

  const commonIds = [...allSets[0]].filter((id) =>
    allSets.every((s) => s.has(id))
  ).sort((a, b) => a - b);

  const firstGroupId = Math.min(...byGroup.keys());
  const canonical = new Map(
    byGroup.get(firstGroupId)!.map((r: any) => [r.questionId, r])
  );

  const questions: Question[] = commonIds.map((qid) => {
    const item = canonical.get(qid)!;
    return {
      questionId: String(qid),
      topic: item.topic ?? "",
      question: item.question ?? "",
      shortLabel: `${item.topic ?? ""}: ${item.question ?? ""}`,
      elaboration: item.elaboration ?? null,
      argumentFor: item.argumentFor ?? null,
      argumentAgainst: item.argumentAgainst ?? null,
    };
  });

  const questionConsistency = Array.from(questionSets.entries())
    .sort(([a], [b]) => a - b)
    .map(([gid, ids]) => ({
      bigGroupId: gid,
      questionCount: ids.size,
      commonQuestionCount: commonIds.length,
      sameAsCommonSet:
        ids.size === commonIds.length &&
        commonIds.every((id) => ids.has(id)),
    }));

  return { questions, questionConsistency };
}

// ── Candidates ──

async function fetchBallotList(
  apiKey: string,
  smallGroupId: number
): Promise<any[]> {
  const payload = await apiGet(apiKey, "/v1/GetBallotList", {
    electionId: ELECTION_ID,
    groupId: smallGroupId,
  });
  return payload.BallotCandidates ?? [];
}

async function fetchCandidateInfo(
  apiKey: string,
  candidateId: number
): Promise<any | null> {
  const payload = await apiGet(apiKey, "/v1/GetCandidate", {
    candidateId,
    electionId: ELECTION_ID,
  });
  return payload?.[0] ?? null;
}

async function fetchCandidateAnswers(
  apiKey: string,
  candidateId: number,
  bigGroupId: number
): Promise<any[]> {
  return apiGet(apiKey, "/v1/GetCandidateAnswers", {
    candidateId,
    electionId: ELECTION_ID,
    valgomatId: VALGOMAT_ID,
    groupId: bigGroupId,
    frontpage: "true",
  });
}

async function prepareCandidates(
  apiKey: string,
  smallConstituencies: any[]
): Promise<{
  candidates: Candidate[];
  candidateBigGroup: Map<number, number>;
}> {
  const byCandidate = new Map<number, any>();
  const candidateBigGroup = new Map<number, number>();

  for (const small of smallConstituencies) {
    const smallId = parseInt(small.ID);
    const rows = await fetchBallotList(apiKey, smallId);
    for (const row of rows) {
      const candidateId = parseInt(row.candidateId);
      const bigGroupId = parseInt(small.ID_BigConstituency);
      candidateBigGroup.set(candidateId, bigGroupId);

      if (!byCandidate.has(candidateId)) {
        byCandidate.set(candidateId, {
          candidateId,
          name: row.name,
          partyId: parseInt(row.partyId),
          partyCode: row.partyCode ?? "",
          partyName: row.partyName,
          urlKey: row.urlKey,
          smallConstituencyIds: new Set<number>(),
          smallConstituencyNames: new Set<string>(),
          bigConstituencyId: bigGroupId,
        });
      }
      const current = byCandidate.get(candidateId)!;
      current.smallConstituencyIds.add(smallId);
      current.smallConstituencyNames.add(small.Name);
    }
  }

  // Fetch candidate info in batches
  const candidateIds = Array.from(byCandidate.keys());
  const infos = new Map<number, any>();

  const BATCH_SIZE = 12;
  for (let i = 0; i < candidateIds.length; i += BATCH_SIZE) {
    const batch = candidateIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((id) => fetchCandidateInfo(apiKey, id))
    );
    for (let j = 0; j < batch.length; j++) {
      infos.set(batch[j], results[j]);
    }
  }

  const candidates: Candidate[] = [];

  for (const [candidateId, c] of byCandidate) {
    const info = infos.get(candidateId) ?? {};
    const lineups = info.LineUps ?? [];
    const primarySmall = lineups.find(
      (l: any) =>
        l.groupType === "SmallConstituency" &&
        String(l.listPriorityNumber ?? "").trim() === "1"
    );
    const bigLineup = lineups.find(
      (l: any) => l.groupType === "Bigconstituency"
    );

    candidates.push({
      candidateId,
      name: c.name,
      partyCode: c.partyCode,
      partyName: c.partyName,
      currentPartyCode: info.CurrentPartyCode ?? c.partyCode,
      currentPartyName: info.CurrentParty ?? c.partyName,
      bigConstituencyId: c.bigConstituencyId,
      bigConstituencyName: bigLineup?.lineUpName ?? "",
      nominationConstituency: primarySmall?.lineUpName ?? "",
      smallConstituencyCount: c.smallConstituencyIds.size,
      smallConstituencyNames: [...c.smallConstituencyNames]
        .sort()
        .join(" | "),
      isPartyLeader:
        normalizePersonName(c.name) ===
        normalizePersonName(PARTY_LEADERS_BY_CODE[c.partyCode]),
      urlKey: c.urlKey,
      partyId: c.partyId,
      birthdate: info.Birthdate ?? null,
      occupation: info.Profession ?? null,
    });
  }

  candidates.sort(
    (a, b) =>
      a.bigConstituencyId - b.bigConstituencyId ||
      a.partyCode.localeCompare(b.partyCode) ||
      a.name.localeCompare(b.name)
  );

  return { candidates, candidateBigGroup };
}

// ── Answers ──

async function prepareAnswers(
  apiKey: string,
  candidates: Candidate[],
  candidateBigGroup: Map<number, number>,
  questionIds: string[]
): Promise<Map<number, Map<string, number | null>>> {
  const questionIdSet = new Set(questionIds.map(Number));
  const answersWide = new Map<number, Map<string, number | null>>();

  const BATCH_SIZE = 12;
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((c) =>
        fetchCandidateAnswers(
          apiKey,
          c.candidateId,
          candidateBigGroup.get(c.candidateId) ?? 0
        )
      )
    );

    for (let j = 0; j < batch.length; j++) {
      const candidateId = batch[j].candidateId;
      const answers = new Map<string, number | null>();

      for (const row of results[j]) {
        const qid = parseInt(row.QuestionID);
        if (!questionIdSet.has(qid)) continue;
        const rawAnswer = parseInt(row.Answer ?? "0");
        const mapped = ANSWER_MAP[rawAnswer] ?? null;
        answers.set(String(qid), mapped);
      }

      answersWide.set(candidateId, answers);
    }
  }

  return answersWide;
}

// ── Main entry point ──

export async function fetchAltingetSource(sourceSlug: "altinget" | "dr"): Promise<{
  election: Election;
  siteMeta: SiteMeta;
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
  const apiKey = getApiKey();

  console.log(`[${sourceSlug}] Fetching election metadata...`);
  const {
    election,
    bigConstituencies,
    smallConstituencies,
    municipalities: rawMunicipalities,
  } = await fetchElectionMetadata(apiKey);

  console.log(`[${sourceSlug}] Building municipality payload...`);
  const municipalities = buildMunicipalityPayload(
    rawMunicipalities,
    bigConstituencies,
    smallConstituencies
  );

  console.log(`[${sourceSlug}] Fetching questions...`);
  const { questions, questionConsistency } = await prepareQuestions(
    apiKey,
    bigConstituencies
  );

  console.log(`[${sourceSlug}] Fetching candidates...`);
  const { candidates, candidateBigGroup } = await prepareCandidates(
    apiKey,
    smallConstituencies
  );

  console.log(`[${sourceSlug}] Fetching answers...`);
  const answersWide = await prepareAnswers(
    apiKey,
    candidates,
    candidateBigGroup,
    questions.map((q) => q.questionId)
  );

  const siteMeta =
    sourceSlug === "altinget" ? ALTINGET_SITE_META : DR_SITE_META;

  console.log(
    `[${sourceSlug}] Done: ${candidates.length} candidates, ${questions.length} questions, ${municipalities.length} municipalities`
  );

  return {
    election,
    siteMeta,
    municipalities,
    questions,
    questionConsistency,
    candidates,
    answersWide,
  };
}
