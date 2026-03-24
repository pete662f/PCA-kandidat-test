/**
 * PCA engine — reimplements scikit-learn's Pipeline(SimpleImputer → StandardScaler → PCA)
 * using ml-matrix for SVD decomposition.
 */

import { SVD } from "ml-matrix";
import type {
  Candidate,
  CandidateScore,
  PcaModel,
  PartyCentroid,
  Question,
  QuestionLoading,
  VarianceRow,
} from "../types.ts";
import {
  ANSWER_MAP,
  MIN_ANSWERED_QUESTIONS,
  PCA_COMPONENTS,
  PARTY_COLORS,
  PARTY_COLOR_FALLBACK,
  TOP_N_SUMMARY_ROWS,
} from "../config.ts";

// ── Statistical helpers ──

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function sampleStd(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance =
    values.reduce((s, v) => s + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function populationStd(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  const variance =
    values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ── Mean imputer ──

function meanImpute(matrix: (number | null)[][]): {
  imputed: number[][];
  statistics: number[];
} {
  const nCols = matrix[0]?.length ?? 0;
  const statistics: number[] = new Array(nCols).fill(0);

  // Compute column means (ignoring nulls)
  for (let j = 0; j < nCols; j++) {
    let sum = 0;
    let count = 0;
    for (const row of matrix) {
      const v = row[j];
      if (v !== null && !Number.isNaN(v)) {
        sum += v;
        count++;
      }
    }
    statistics[j] = count > 0 ? sum / count : 0;
  }

  // Fill nulls with column means
  const imputed = matrix.map((row) =>
    row.map((v, j) =>
      v === null || Number.isNaN(v) ? statistics[j] : v
    )
  );

  return { imputed, statistics };
}

// ── StandardScaler ──

function standardScale(matrix: number[][]): {
  scaled: number[][];
  mean: number[];
  scale: number[];
} {
  const nCols = matrix[0]?.length ?? 0;
  const colMean: number[] = new Array(nCols).fill(0);
  const colScale: number[] = new Array(nCols).fill(1);

  for (let j = 0; j < nCols; j++) {
    const col = matrix.map((row) => row[j]);
    colMean[j] = mean(col);
    // scikit-learn StandardScaler uses ddof=0 (population std)
    const std = populationStd(col);
    colScale[j] = std === 0 ? 1 : std;
  }

  const scaled = matrix.map((row) =>
    row.map((v, j) => (v - colMean[j]) / colScale[j])
  );

  return { scaled, mean: colMean, scale: colScale };
}

// ── PCA via SVD ──

function pcaFit(
  matrix: number[][],
  nComponents: number
): {
  components: number[][]; // [nComponents x nFeatures]
  explainedVariance: number[];
  explainedVarianceRatio: number[];
  mean: number[];
} {
  const nSamples = matrix.length;
  const nFeatures = matrix[0]?.length ?? 0;

  // Center the data
  const colMeans: number[] = new Array(nFeatures).fill(0);
  for (let j = 0; j < nFeatures; j++) {
    let sum = 0;
    for (const row of matrix) sum += row[j];
    colMeans[j] = sum / nSamples;
  }

  const centered = matrix.map((row) =>
    row.map((v, j) => v - colMeans[j])
  );

  // SVD of centered data
  const svd = new SVD(centered, { autoTranspose: true });
  const S = svd.diagonal; // singular values
  const Vt = svd.rightSingularVectors; // V^T [nFeatures x nFeatures]

  // Components are the first nComponents rows of V^T
  const components: number[][] = [];
  for (let i = 0; i < nComponents; i++) {
    const comp: number[] = [];
    for (let j = 0; j < nFeatures; j++) {
      comp.push(Vt.get(j, i)); // V columns = right singular vectors
    }
    components.push(comp);
  }

  // Flip PC1 so that positive = right-wing, negative = left-wing
  // (PCA sign is arbitrary; this matches the conventional political compass)
  components[0] = components[0].map((v) => -v);

  // Explained variance = S^2 / (n_samples - 1)
  const explainedVariance = S.slice(0, nComponents).map(
    (s) => (s * s) / (nSamples - 1)
  );

  const totalVariance = S.reduce((sum, s) => sum + (s * s) / (nSamples - 1), 0);
  const explainedVarianceRatio = explainedVariance.map((v) => v / totalVariance);

  return { components, explainedVariance, explainedVarianceRatio, mean: colMeans };
}

function pcaTransform(
  matrix: number[][],
  components: number[][],
  mean: number[]
): number[][] {
  return matrix.map((row) => {
    const centered = row.map((v, j) => v - mean[j]);
    return components.map((comp) =>
      comp.reduce((sum, w, j) => sum + centered[j] * w, 0)
    );
  });
}

// ── Full PCA pipeline ──

export interface PcaResult {
  scores: CandidateScore[];
  loadings: QuestionLoading[];
  partyCentroids: PartyCentroid[];
  variance: VarianceRow[];
  model: PcaModel;
}

export function runPca(
  candidates: Candidate[],
  answersWide: Map<number, Map<string, number | null>>,
  questions: Question[]
): PcaResult {
  const questionIds = questions.map((q) => q.questionId);

  // Count answered per candidate
  const answeredCounts = new Map<number, number>();
  for (const candidate of candidates) {
    const answers = answersWide.get(candidate.candidateId);
    let count = 0;
    if (answers) {
      for (const qid of questionIds) {
        const v = answers.get(qid);
        if (v !== null && v !== undefined && !Number.isNaN(v)) count++;
      }
    }
    answeredCounts.set(candidate.candidateId, count);
  }

  // Filter candidates with enough answers
  const retainedCandidates = candidates.filter(
    (c) => (answeredCounts.get(c.candidateId) ?? 0) >= MIN_ANSWERED_QUESTIONS
  );

  if (retainedCandidates.length < PCA_COMPONENTS) {
    throw new Error(
      `Not enough candidates (${retainedCandidates.length}) with >= ${MIN_ANSWERED_QUESTIONS} answers for PCA.`
    );
  }

  // Build answer matrix [nCandidates x nQuestions]
  const rawMatrix: (number | null)[][] = retainedCandidates.map((c) => {
    const answers = answersWide.get(c.candidateId);
    return questionIds.map((qid) => {
      if (!answers) return null;
      const v = answers.get(qid);
      return v === undefined ? null : v;
    });
  });

  // Step 1: Mean imputation
  const { imputed, statistics: imputerStatistics } = meanImpute(rawMatrix);

  // Step 2: Standard scaling
  const { scaled, mean: scalerMean, scale: scalerScale } = standardScale(imputed);

  // Step 3: PCA
  const pca = pcaFit(scaled, PCA_COMPONENTS);
  const scoreMatrix = pcaTransform(scaled, pca.components, pca.mean);

  // Build score columns
  const componentNames = Array.from(
    { length: PCA_COMPONENTS },
    (_, i) => `PC${i + 1}`
  );

  // Build candidate scores
  const scores: CandidateScore[] = retainedCandidates.map((c, idx) => ({
    ...c,
    PC1: scoreMatrix[idx][0],
    PC2: scoreMatrix[idx][1],
    PC3: scoreMatrix[idx][2],
    PC4: scoreMatrix[idx][3],
    answeredQuestions: answeredCounts.get(c.candidateId) ?? 0,
    imputedQuestions:
      questionIds.length - (answeredCounts.get(c.candidateId) ?? 0),
  }));

  // Build loadings
  const loadingMatrix = pca.components[0].map((_, j) =>
    pca.components.map(
      (comp, i) => comp[j] * Math.sqrt(pca.explainedVariance[i])
    )
  );

  const loadings: QuestionLoading[] = questions.map((q, j) => ({
    ...q,
    PC1: loadingMatrix[j][0],
    PC2: loadingMatrix[j][1],
    PC3: loadingMatrix[j][2],
    PC4: loadingMatrix[j][3],
    questionMeanMapped: imputerStatistics[j],
    questionScaleSd: scalerScale[j],
  }));

  // Build party centroids
  const byParty = new Map<string, CandidateScore[]>();
  for (const s of scores) {
    const key = s.partyName;
    if (!byParty.has(key)) byParty.set(key, []);
    byParty.get(key)!.push(s);
  }

  const partyCentroids: PartyCentroid[] = Array.from(byParty.entries())
    .map(([partyName, rows]) => {
      const pc1Vals = rows.map((r) => r.PC1);
      const pc2Vals = rows.map((r) => r.PC2);
      const pc3Vals = rows.map((r) => r.PC3);
      const pc4Vals = rows.map((r) => r.PC4);
      const pc1Sd = sampleStd(pc1Vals);
      const pc2Sd = sampleStd(pc2Vals);
      const pc1Mean = mean(pc1Vals);
      const pc2Mean = mean(pc2Vals);

      return {
        partyCode: rows[0].partyCode,
        partyName,
        candidateCount: rows.length,
        PC1: pc1Mean,
        PC2: pc2Mean,
        PC3: mean(pc3Vals),
        PC4: mean(pc4Vals),
        pc1Sd,
        pc2Sd,
        radialDistance: Math.sqrt(pc1Mean ** 2 + pc2Mean ** 2),
        internalDispersion: Math.sqrt(pc1Sd ** 2 + pc2Sd ** 2),
      };
    })
    .sort((a, b) => a.PC1 - b.PC1 || a.PC2 - b.PC2);

  // Build variance table
  let cumulative = 0;
  const variance: VarianceRow[] = pca.explainedVarianceRatio.map((ratio, i) => {
    cumulative += ratio * 100;
    return {
      component: componentNames[i],
      explainedVarianceRatio: ratio,
      explainedVariancePct: ratio * 100,
      cumulativeExplainedVariancePct: cumulative,
    };
  });

  // Build model payload for client-side projection
  const model: PcaModel = {
    questionIds: questionIds.map(String),
    questions: questions.map((q) => ({
      questionId: q.questionId,
      topic: q.topic,
      question: q.question,
      shortLabel: q.shortLabel,
    })),
    imputerStatistics,
    scalerMean,
    scalerScale,
    pcaComponents: pca.components,
    pcaMean: pca.mean,
    components: componentNames,
    answerMap: Object.fromEntries(
      Object.entries(ANSWER_MAP).map(([k, v]) => [String(k), v])
    ),
  };

  return { scores, loadings, partyCentroids, variance, model };
}

// ── Project answers using a fitted model (for API) ──

export function projectAnswers(
  model: PcaModel,
  answers: Map<string, number>
): { PC1: number; PC2: number; PC3: number; PC4: number; answeredQuestions: number } {
  const answerVector: number[] = [];
  let answeredQuestions = 0;

  for (let i = 0; i < model.questionIds.length; i++) {
    const qid = model.questionIds[i];
    const answer = answers.get(qid);
    if (answer !== undefined) {
      answerVector.push(answer);
      answeredQuestions++;
    } else {
      answerVector.push(model.imputerStatistics[i]);
    }
  }

  if (answeredQuestions === 0) {
    throw new Error("No valid answers provided.");
  }

  // Standardize
  const standardized = answerVector.map(
    (v, i) => (v - model.scalerMean[i]) / (model.scalerScale[i] || 1)
  );

  // Center
  const centered = standardized.map((v, i) => v - (model.pcaMean[i] || 0));

  // Project
  const scores = model.pcaComponents.map((comp) =>
    comp.reduce((sum, w, i) => sum + centered[i] * w, 0)
  );

  return {
    PC1: scores[0] ?? 0,
    PC2: scores[1] ?? 0,
    PC3: scores[2] ?? 0,
    PC4: scores[3] ?? 0,
    answeredQuestions,
  };
}

// ── Party color helper ──

export function getPartyColor(partyCode: string): string {
  return PARTY_COLORS[partyCode] ?? PARTY_COLOR_FALLBACK;
}

// ── Loading helpers ──

export function getTopLoadings(
  loadings: QuestionLoading[],
  component: "PC1" | "PC2" | "PC3" | "PC4",
  positive: boolean,
  limit: number = TOP_N_SUMMARY_ROWS
): { topic: string; question: string; loading: number }[] {
  const sorted = [...loadings].sort((a, b) =>
    positive ? b[component] - a[component] : a[component] - b[component]
  );
  return sorted.slice(0, limit).map((l) => ({
    topic: l.topic,
    question: l.question,
    loading: l[component],
  }));
}
