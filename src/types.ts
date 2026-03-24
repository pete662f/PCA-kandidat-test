// ── Core domain types ──

export interface Election {
  id: number;
  prefix: string;
  name: string;
  valgomatId: number;
}

export interface SiteMeta {
  sourceSlug: string;
  sourceLabel: string;
  sourceDescription: string;
  sourceAttribution: string;
  uploadHelpHtml: string;
}

export interface Question {
  questionId: string;
  topic: string;
  question: string;
  shortLabel: string;
  elaboration?: string | null;
  argumentFor?: string | null;
  argumentAgainst?: string | null;
}

export interface Candidate {
  candidateId: number;
  name: string;
  partyCode: string;
  partyName: string;
  currentPartyCode: string;
  currentPartyName: string;
  bigConstituencyId: number;
  bigConstituencyName: string;
  nominationConstituency: string;
  smallConstituencyCount: number;
  smallConstituencyNames: string;
  isPartyLeader: boolean;
  urlKey: string;
  birthdate?: string | null;
  occupation?: string | null;
  partyId?: number | null;
  isIncumbent?: boolean | null;
}

export interface AnswerRow {
  candidateId: number;
  questionId: string;
  rawAnswer: number | null;
  mappedAnswer: number | null;
  isImportant: number;
  comment: string | null;
}

export interface Municipality {
  name: string;
  kmdId: number;
  bigConstituencyName: string;
  smallConstituencies: string[];
}

// ── PCA result types ──

export interface CandidateScore extends Candidate {
  PC1: number;
  PC2: number;
  PC3: number;
  PC4: number;
  answeredQuestions: number;
  imputedQuestions: number;
  color?: string;
}

export interface QuestionLoading extends Question {
  PC1: number;
  PC2: number;
  PC3: number;
  PC4: number;
  questionMeanMapped: number;
  questionScaleSd: number;
}

export interface PartyCentroid {
  partyCode: string;
  partyName: string;
  candidateCount: number;
  PC1: number;
  PC2: number;
  PC3: number;
  PC4: number;
  pc1Sd: number;
  pc2Sd: number;
  radialDistance: number;
  internalDispersion: number;
}

export interface VarianceRow {
  component: string;
  explainedVarianceRatio: number;
  explainedVariancePct: number;
  cumulativeExplainedVariancePct: number;
}

export interface PcaModel {
  questionIds: string[];
  questions: Question[];
  imputerStatistics: number[];
  scalerMean: number[];
  scalerScale: number[];
  pcaComponents: number[][];
  pcaMean: number[];
  components: string[];
  answerMap: Record<string, number>;
}

// ── Site payload types (what gets sent to the frontend) ──

export interface InteractiveCandidate {
  candidate_id: number;
  name: string;
  party_code: string;
  party_name: string;
  big_constituency_name: string;
  nomination_constituency: string;
  small_constituency_names: string[];
  is_party_leader: boolean;
  answered_questions: number;
  PC1: number;
  PC2: number;
  PC3: number;
  PC4: number;
  color: string;
}

export interface BallotCandidate {
  candidate_id: number;
  name: string;
  party_code: string;
  party_name: string;
  big_constituency_name: string;
  nomination_constituency: string;
  small_constituency_names: string[];
}

export interface SitePayload {
  summary: Record<string, any>;
  municipalities: Municipality[];
  candidates: InteractiveCandidate[];
  ballot_candidates: BallotCandidate[];
  variance: VarianceRow[];
  loadings: Record<string, LoadingRow[]>;
  model: {
    question_ids: string[];
    questions: Array<{
      question_id: string;
      topic: string;
      question: string;
      short_label: string;
    }>;
    imputer_statistics: number[];
    scaler_mean: number[];
    scaler_scale: number[];
    pca_components: number[][];
    pca_mean: number[];
    components: string[];
    answer_map: Record<string, number>;
  };
  site_meta: {
    source_slug: string;
    source_label: string;
    source_description: string;
    source_attribution: string;
    upload_help_html: string;
  };
}

export interface LoadingRow {
  topic: string;
  question: string;
  loading: number;
}

// ── Source data bundle (output of data fetching + PCA) ──

export interface SourceDataBundle {
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
  answersWide: Map<number, Map<string, number | null>>; // candidateId -> questionId -> answer
  scores: CandidateScore[];
  loadings: QuestionLoading[];
  partyCentroids: PartyCentroid[];
  variance: VarianceRow[];
  model: PcaModel;
  sitePayload: SitePayload;
}

// ── API types ──

export interface ApiAnswerInput {
  question_id: string;
  answer: number | string;
}

export interface ApiTakeTestRequest {
  source: string;
  answers: ApiAnswerInput[];
}

export interface ApiTakeTestResponse {
  scores: { PC1: number; PC2: number; PC3: number; PC4: number };
  answered_questions: number;
  total_questions: number;
  closest_parties: Array<{
    party_name: string;
    party_code: string;
    distance: number;
    PC1: number;
    PC2: number;
    PC3: number;
    PC4: number;
  }>;
  closest_candidates: Array<{
    name: string;
    party_name: string;
    party_code: string;
    distance: number;
    PC1: number;
    PC2: number;
  }>;
}
