/**
 * In-memory data store. Fetches source data, runs PCA, and caches results.
 */

import type {
  SourceDataBundle,
  SitePayload,
  InteractiveCandidate,
  BallotCandidate,
  LoadingRow,
} from "../types.ts";
import { runPca, getPartyColor, getTopLoadings } from "../lib/pca.ts";
import { fetchTv2Source } from "./tv2.ts";
import { fetchAltingetSource } from "./altinget.ts";

// ── Global store ──

const store = new Map<string, SourceDataBundle>();
let loading = new Map<string, Promise<void>>();

function splitPipeNames(raw: string): string[] {
  if (!raw) return [];
  return raw.split(" | ").map((s) => s.trim()).filter(Boolean);
}

function buildSitePayload(bundle: Omit<SourceDataBundle, "sitePayload">): SitePayload {
  const {
    election,
    siteMeta,
    municipalities,
    questions,
    questionConsistency,
    candidates,
    answersWide,
    scores,
    loadings,
    partyCentroids,
    variance,
    model,
  } = bundle;

  // Answered counts for all candidates
  const answeredCounts = new Map<number, number>();
  for (const c of candidates) {
    const answers = answersWide.get(c.candidateId);
    let count = 0;
    if (answers) {
      for (const qid of questions.map((q) => q.questionId)) {
        const v = answers.get(qid);
        if (v !== null && v !== undefined && !Number.isNaN(v)) count++;
      }
    }
    answeredCounts.set(c.candidateId, count);
  }

  // Summary
  const allAnswered = Array.from(answeredCounts.values()).sort((a, b) => a - b);
  const medianAnswered =
    allAnswered.length > 0
      ? allAnswered[Math.floor(allAnswered.length / 2)]
      : 0;

  const summary = {
    election_name: election.name,
    run_date: new Date().toISOString().split("T")[0],
    candidate_total: candidates.length,
    candidate_retained: scores.length,
    candidate_excluded: candidates.length - scores.length,
    party_total: partyCentroids.length,
    question_total: questions.length,
    median_answered: medianAnswered,
    question_set_deviations: questionConsistency.filter(
      (c) => !c.sameAsCommonSet
    ).length,
    pc1_pct: variance[0]?.explainedVariancePct ?? 0,
    pc2_pct: variance[1]?.explainedVariancePct ?? 0,
    pc3_pct: variance[2]?.explainedVariancePct ?? 0,
    pc4_pct: variance[3]?.explainedVariancePct ?? 0,
    pc12_pct: variance[1]?.cumulativeExplainedVariancePct ?? 0,
    pc1234_pct: variance[3]?.cumulativeExplainedVariancePct ?? 0,
  };

  // Interactive candidates
  const interactiveCandidates: InteractiveCandidate[] = scores
    .map((s) => ({
      candidate_id: s.candidateId,
      name: s.name,
      party_code: s.partyCode,
      party_name: s.partyName,
      big_constituency_name: s.bigConstituencyName,
      nomination_constituency: s.nominationConstituency,
      small_constituency_names: splitPipeNames(s.smallConstituencyNames),
      is_party_leader: s.isPartyLeader,
      answered_questions: s.answeredQuestions,
      PC1: s.PC1,
      PC2: s.PC2,
      PC3: s.PC3,
      PC4: s.PC4,
      color: getPartyColor(s.partyCode),
    }))
    .sort(
      (a, b) =>
        a.party_name.localeCompare(b.party_name, "da") ||
        a.name.localeCompare(b.name, "da")
    );

  // Ballot candidates (all, not just PCA-retained)
  const ballotCandidates: BallotCandidate[] = candidates
    .map((c) => ({
      candidate_id: c.candidateId,
      name: c.name,
      party_code: c.partyCode,
      party_name: c.partyName,
      big_constituency_name: c.bigConstituencyName,
      nomination_constituency: c.nominationConstituency,
      small_constituency_names: splitPipeNames(c.smallConstituencyNames),
    }))
    .sort(
      (a, b) =>
        a.party_name.localeCompare(b.party_name, "da") ||
        a.name.localeCompare(b.name, "da")
    );

  // Loadings payload
  const loadingPayload: Record<string, LoadingRow[]> = {};
  for (const pc of ["PC1", "PC2", "PC3", "PC4"] as const) {
    loadingPayload[`${pc.toLowerCase()}_negative`] = getTopLoadings(
      loadings,
      pc,
      false
    );
    loadingPayload[`${pc.toLowerCase()}_positive`] = getTopLoadings(
      loadings,
      pc,
      true
    );
  }

  return {
    summary,
    municipalities,
    candidates: interactiveCandidates,
    ballot_candidates: ballotCandidates,
    variance: variance.map((v) => ({
      ...v,
      component: v.component,
      explained_variance_ratio: v.explainedVarianceRatio,
      explained_variance_pct: v.explainedVariancePct,
      cumulative_explained_variance_pct: v.cumulativeExplainedVariancePct,
    })),
    loadings: loadingPayload,
    model: {
      question_ids: model.questionIds,
      questions: model.questions.map((q) => ({
        question_id: q.questionId,
        topic: q.topic,
        question: q.question,
        short_label: q.shortLabel,
      })),
      imputer_statistics: model.imputerStatistics,
      scaler_mean: model.scalerMean,
      scaler_scale: model.scalerScale,
      pca_components: model.pcaComponents,
      pca_mean: model.pcaMean,
      components: model.components,
      answer_map: model.answerMap,
    },
    site_meta: {
      source_slug: siteMeta.sourceSlug,
      source_label: siteMeta.sourceLabel,
      source_description: siteMeta.sourceDescription,
      source_attribution: siteMeta.sourceAttribution,
      upload_help_html: siteMeta.uploadHelpHtml,
    },
  };
}

export async function loadSource(sourceSlug: string): Promise<void> {
  // Prevent double-loading
  if (store.has(sourceSlug)) return;
  if (loading.has(sourceSlug)) {
    await loading.get(sourceSlug);
    return;
  }

  const promise = (async () => {
    console.log(`[DataStore] Loading source "${sourceSlug}"...`);
    const startTime = Date.now();

    let sourceData;
    if (sourceSlug === "tv2") {
      sourceData = await fetchTv2Source();
    } else if (sourceSlug === "altinget" || sourceSlug === "dr") {
      sourceData = await fetchAltingetSource(
        sourceSlug as "altinget" | "dr"
      );
    } else {
      throw new Error(`Unknown source: ${sourceSlug}`);
    }

    console.log(`[DataStore] Running PCA for "${sourceSlug}"...`);
    const pcaResult = runPca(
      sourceData.candidates,
      sourceData.answersWide,
      sourceData.questions
    );

    const bundleWithoutPayload = {
      ...sourceData,
      scores: pcaResult.scores,
      loadings: pcaResult.loadings,
      partyCentroids: pcaResult.partyCentroids,
      variance: pcaResult.variance,
      model: pcaResult.model,
    };

    const sitePayload = buildSitePayload(bundleWithoutPayload);

    const bundle: SourceDataBundle = {
      ...bundleWithoutPayload,
      sitePayload,
    };

    store.set(sourceSlug, bundle);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[DataStore] Source "${sourceSlug}" ready in ${elapsed}s`);
  })();

  loading.set(sourceSlug, promise);
  try {
    await promise;
  } finally {
    loading.delete(sourceSlug);
  }
}

export function getBundle(sourceSlug: string): SourceDataBundle | undefined {
  return store.get(sourceSlug);
}

export function getAvailableSources(): string[] {
  return Array.from(store.keys());
}

export function isSourceLoaded(sourceSlug: string): boolean {
  return store.has(sourceSlug);
}
