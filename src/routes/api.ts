/**
 * REST API routes for LLMs and programmatic access.
 */

import { Hono } from "hono";
import { getBundle, getAvailableSources } from "../services/data-store.ts";
import { projectAnswers, getPartyColor } from "../lib/pca.ts";
import { ANSWER_MAP } from "../config.ts";
import type { ApiTakeTestRequest, ApiTakeTestResponse } from "../types.ts";

export const apiRouter = new Hono();

// ── GET /api/sources ──

apiRouter.get("/sources", (c) => {
  const sources = getAvailableSources();
  return c.json({
    sources: sources.map((slug) => {
      const bundle = getBundle(slug)!;
      return {
        slug,
        label: bundle.siteMeta.sourceLabel,
        description: bundle.siteMeta.sourceDescription,
        candidate_count: bundle.candidates.length,
        question_count: bundle.questions.length,
        party_count: bundle.partyCentroids.length,
      };
    }),
    usage: {
      step_1: "GET /api/questions?source=<slug> — hent alle spørgsmål",
      step_2: "POST /api/take-test — indsend svar og få resultat + upload-fil",
      step_3: "Upload den returnerede upload_file JSON på hjemmesiden for at se din profil i grafen",
    },
  });
});

// ── GET /api/questions ──

apiRouter.get("/questions", (c) => {
  const source = c.req.query("source") ?? getAvailableSources()[0];
  const bundle = getBundle(source);
  if (!bundle)
    return c.json(
      {
        error: `Source "${source}" not available. Use GET /api/sources to see available sources.`,
      },
      404
    );

  return c.json({
    source,
    total: bundle.questions.length,
    instructions:
      "Answer each question on a scale from -2 (helt uenig / strongly disagree) to +2 (helt enig / strongly agree). Use 0 for neutral. Submit answers via POST /api/take-test.",
    answer_scale: {
      "-2": "Helt uenig (strongly disagree)",
      "-1": "Uenig (disagree)",
      "0": "Neutral / spring over (skip)",
      "1": "Enig (agree)",
      "2": "Helt enig (strongly agree)",
    },
    how_to_answer: {
      description:
        "Besvar alle spørgsmål og send dem via POST /api/take-test. Svaret indeholder din PCA-position, nærmeste partier, nærmeste kandidater, samt en upload-fil du kan uploade på hjemmesiden.",
      example_request: {
        method: "POST",
        url: "/api/take-test",
        headers: { "Content-Type": "application/json" },
        body: {
          source,
          label: "Mit navn",
          answers: [
            {
              question_id: bundle.questions[0]?.questionId ?? "example-id",
              answer: 2,
            },
            {
              question_id: bundle.questions[1]?.questionId ?? "example-id-2",
              answer: -1,
            },
          ],
        },
      },
    },
    questions: bundle.questions.map((q) => ({
      question_id: q.questionId,
      topic: q.topic,
      question: q.question,
      ...(q.elaboration ? { elaboration: q.elaboration } : {}),
      ...(q.argumentFor ? { argument_for: q.argumentFor } : {}),
      ...(q.argumentAgainst ? { argument_against: q.argumentAgainst } : {}),
    })),
  });
});

// ── GET /api/parties ──

apiRouter.get("/parties", (c) => {
  const source = c.req.query("source") ?? getAvailableSources()[0];
  const bundle = getBundle(source);
  if (!bundle)
    return c.json({ error: `Source "${source}" not available.` }, 404);

  return c.json({
    source,
    parties: bundle.partyCentroids.map((p) => ({
      party_code: p.partyCode,
      party_name: p.partyName,
      candidate_count: p.candidateCount,
      color: getPartyColor(p.partyCode),
      PC1: parseFloat(p.PC1.toFixed(4)),
      PC2: parseFloat(p.PC2.toFixed(4)),
      PC3: parseFloat(p.PC3.toFixed(4)),
      PC4: parseFloat(p.PC4.toFixed(4)),
      internal_dispersion: parseFloat(p.internalDispersion.toFixed(4)),
    })),
    variance_explained: bundle.variance.map((v) => ({
      component: v.component,
      pct: parseFloat(v.explainedVariancePct.toFixed(2)),
    })),
  });
});

// ── GET /api/candidates ──

apiRouter.get("/candidates", (c) => {
  const source = c.req.query("source") ?? getAvailableSources()[0];
  const bundle = getBundle(source);
  if (!bundle)
    return c.json({ error: `Source "${source}" not available.` }, 404);

  const limit = Math.min(parseInt(c.req.query("limit") ?? "100"), 1000);
  const offset = parseInt(c.req.query("offset") ?? "0");
  const party = c.req.query("party");

  let candidates = bundle.scores;
  if (party) {
    candidates = candidates.filter(
      (s) =>
        s.partyCode.toLowerCase() === party.toLowerCase() ||
        s.partyName.toLowerCase() === party.toLowerCase()
    );
  }

  return c.json({
    source,
    total: candidates.length,
    offset,
    limit,
    candidates: candidates.slice(offset, offset + limit).map((s) => ({
      candidate_id: s.candidateId,
      name: s.name,
      party_code: s.partyCode,
      party_name: s.partyName,
      constituency: s.bigConstituencyName,
      is_party_leader: s.isPartyLeader,
      answered_questions: s.answeredQuestions,
      PC1: parseFloat(s.PC1.toFixed(4)),
      PC2: parseFloat(s.PC2.toFixed(4)),
      PC3: parseFloat(s.PC3.toFixed(4)),
      PC4: parseFloat(s.PC4.toFixed(4)),
    })),
  });
});

// ── POST /api/take-test ──

apiRouter.post("/take-test", async (c) => {
  let body: ApiTakeTestRequest & { label?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: "Invalid JSON body.",
        usage: {
          method: "POST",
          url: "/api/take-test",
          content_type: "application/json",
          body: {
            source: "tv2",
            label: "Mit navn (valgfrit — bruges som navn i grafen)",
            answers: [
              { question_id: "<question_id fra GET /api/questions>", answer: "<-2 | -1 | 0 | 1 | 2>" },
            ],
          },
        },
      },
      400
    );
  }

  const source = body.source ?? getAvailableSources()[0];
  const bundle = getBundle(source);
  if (!bundle)
    return c.json({ error: `Source "${source}" not available.` }, 404);

  if (!body.answers || !Array.isArray(body.answers) || body.answers.length === 0) {
    return c.json(
      {
        error: 'Manglende eller tom "answers"-array. Angiv mindst ét svar.',
        usage: {
          description: "Hent spørgsmål med GET /api/questions?source=" + source + " og send svarene her.",
          body: {
            source,
            label: "Mit navn (valgfrit)",
            answers: [
              { question_id: bundle.questions[0]?.questionId ?? "...", answer: 2 },
              { question_id: bundle.questions[1]?.questionId ?? "...", answer: -1 },
            ],
          },
        },
      },
      400
    );
  }

  // Parse answers into a Map + build upload file
  const answerMap = new Map<string, number>();
  const uploadAnswers: Record<string, number> = {};
  const errors: string[] = [];

  for (const a of body.answers) {
    const qid = String(a.question_id ?? "").trim();
    if (!qid) {
      errors.push(`Manglende question_id i svar: ${JSON.stringify(a)}`);
      continue;
    }

    // Validate question exists
    if (!bundle.model.questionIds.includes(qid)) {
      errors.push(`Ukendt question_id: "${qid}"`);
      continue;
    }

    // Parse answer value
    let value: number;
    if (typeof a.answer === "number") {
      value = a.answer;
    } else {
      const parsed = parseFloat(String(a.answer));
      if (isNaN(parsed)) {
        const intVal = parseInt(String(a.answer));
        if (ANSWER_MAP[intVal] !== undefined) {
          value = ANSWER_MAP[intVal];
        } else {
          errors.push(
            `Ugyldigt svar for spørgsmål ${qid}: "${a.answer}"`
          );
          continue;
        }
      } else {
        if (
          Number.isInteger(parsed) &&
          ANSWER_MAP[parsed] !== undefined &&
          ![-2, -1, 0, 1, 2].includes(parsed)
        ) {
          value = ANSWER_MAP[parsed];
        } else {
          value = parsed;
        }
      }
    }

    // Skip neutral (0) answers
    if (value === 0) continue;

    // Validate range
    if (value < -2 || value > 2) {
      errors.push(
        `Svar for spørgsmål ${qid} er uden for intervallet [-2, 2]: ${value}`
      );
      continue;
    }

    answerMap.set(qid, value);
    uploadAnswers[qid] = value;
  }

  if (answerMap.size === 0) {
    return c.json(
      {
        error: "Ingen gyldige svar fundet.",
        details: errors.length ? errors : undefined,
      },
      400
    );
  }

  // Project answers
  let projection;
  try {
    projection = projectAnswers(bundle.model, answerMap);
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }

  // Find closest parties
  const closestParties = bundle.partyCentroids
    .map((p) => ({
      party_name: p.partyName,
      party_code: p.partyCode,
      distance: parseFloat(
        Math.sqrt(
          (projection.PC1 - p.PC1) ** 2 +
            (projection.PC2 - p.PC2) ** 2 +
            (projection.PC3 - p.PC3) ** 2 +
            (projection.PC4 - p.PC4) ** 2
        ).toFixed(4)
      ),
      PC1: parseFloat(p.PC1.toFixed(4)),
      PC2: parseFloat(p.PC2.toFixed(4)),
      PC3: parseFloat(p.PC3.toFixed(4)),
      PC4: parseFloat(p.PC4.toFixed(4)),
    }))
    .sort((a, b) => a.distance - b.distance);

  // Find closest candidates (top 10)
  const closestCandidates = bundle.scores
    .map((s) => ({
      name: s.name,
      party_name: s.partyName,
      party_code: s.partyCode,
      distance: parseFloat(
        Math.sqrt(
          (projection.PC1 - s.PC1) ** 2 +
            (projection.PC2 - s.PC2) ** 2
        ).toFixed(4)
      ),
      PC1: parseFloat(s.PC1.toFixed(4)),
      PC2: parseFloat(s.PC2.toFixed(4)),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 10);

  // Build the upload file — compatible with the website's JSON upload
  const profileLabel = body.label?.trim() || "API-profil";
  const uploadFile = {
    answers: uploadAnswers,
  };

  const response: ApiTakeTestResponse = {
    scores: {
      PC1: parseFloat(projection.PC1.toFixed(4)),
      PC2: parseFloat(projection.PC2.toFixed(4)),
      PC3: parseFloat(projection.PC3.toFixed(4)),
      PC4: parseFloat(projection.PC4.toFixed(4)),
    },
    answered_questions: projection.answeredQuestions,
    total_questions: bundle.model.questionIds.length,
    closest_parties: closestParties,
    closest_candidates: closestCandidates,
  };

  return c.json({
    ...response,
    upload_file: {
      description:
        "Gem dette JSON-objekt som en .json-fil og upload det på hjemmesiden for at se din profil i graferne. Filnavnet bliver dit navn i grafen.",
      filename_suggestion: `${profileLabel.replace(/[^a-zA-Z0-9æøåÆØÅ _-]/g, "")}.json`,
      content: uploadFile,
    },
    warnings: errors.length ? errors : undefined,
  });
});

// ── GET /api/model ──

apiRouter.get("/model", (c) => {
  const source = c.req.query("source") ?? getAvailableSources()[0];
  const bundle = getBundle(source);
  if (!bundle)
    return c.json({ error: `Source "${source}" not available.` }, 404);

  return c.json({
    source,
    model: bundle.sitePayload.model,
  });
});
