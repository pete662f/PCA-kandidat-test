const candidateChartEl = document.getElementById("candidate-chart");
const candidateChart34El = document.getElementById("candidate-chart-34");
const centroidChartEl = document.getElementById("centroid-chart");
const centroidChart34El = document.getElementById("centroid-chart-34");
const explainedVarianceChartEl = document.getElementById("explained-variance-chart");
const filterEl = document.getElementById("party-filter");
const municipalitySelectEl = document.getElementById("municipality-select");
const municipalitySummaryEl = document.getElementById("municipality-summary");
const answersUploadInputEl = document.getElementById("answers-upload-input");
const clearUploadButtonEl = document.getElementById("clear-upload-button");
const uploadStatusEl = document.getElementById("upload-status");
const uploadProfilesEl = document.getElementById("upload-profiles");
const partySectionCopyEl = document.getElementById("party-section-copy");
const figureSectionCopyEl = document.getElementById("figure-section-copy");
const tablePc1NegEl = document.getElementById("table-pc1-neg");
const tablePc1PosEl = document.getElementById("table-pc1-pos");
const tablePc2NegEl = document.getElementById("table-pc2-neg");
const tablePc2PosEl = document.getElementById("table-pc2-pos");
const tableDispersionEl = document.getElementById("table-dispersion");
const tableCandidatesEl = document.getElementById("table-candidates");
let siteData = null;
let activeParties = new Set();
let axisRanges = null;
let selectedMunicipality = "__all__";
let uploadedProfiles = [];

const ALL_MUNICIPALITIES = "__all__";
const TABLE_LIMIT = 5;

function groupBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key];
    if (!acc.has(value)) acc.set(value, []);
    acc.get(value).push(item);
    return acc;
  }, new Map());
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStd(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function formatNumber(value) {
  return Number(value).toFixed(2);
}

function updateUploadStatus(message, tone = "") {
  uploadStatusEl.textContent = message;
  uploadStatusEl.classList.remove("is-success", "is-error");
  if (tone) {
    uploadStatusEl.classList.add(tone);
  }
}

function setUploadButtonState() {
  clearUploadButtonEl.disabled = !uploadedProfiles.length;
}

function currentAxisRanges(xKey, yKey) {
  if (!axisRanges) {
    return null;
  }
  const key = `${xKey}_${yKey}`;
  const baseRanges = axisRanges[key];
  if (!baseRanges) {
    return null;
  }
  if (!uploadedProfiles.length) {
    return baseRanges;
  }
  const xPad = Math.max((baseRanges.x[1] - baseRanges.x[0]) * 0.04, 0.35);
  const yPad = Math.max((baseRanges.y[1] - baseRanges.y[0]) * 0.04, 0.35);
  const profileXs = uploadedProfiles.map((profile) => profile[xKey]);
  const profileYs = uploadedProfiles.map((profile) => profile[yKey]);
  return {
    x: [
      Math.min(baseRanges.x[0], ...profileXs.map((value) => value - xPad)),
      Math.max(baseRanges.x[1], ...profileXs.map((value) => value + xPad))
    ],
    y: [
      Math.min(baseRanges.y[0], ...profileYs.map((value) => value - yPad)),
      Math.max(baseRanges.y[1], ...profileYs.map((value) => value + yPad))
    ]
  };
}

function parseJsonAnswerRows(text) {
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error("JSON-filen kunne ikke læses.");
  }
  function normalizeAnswerRowObject(row) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return [];
    }
    const questionId = row.question_id ?? row.questionId ?? row.questionID ?? row.id ?? row.key ?? "";
    const questionText = row.question ?? row.questionText ?? row.text ?? row.label ?? row.title ?? "";
    const answer = row.answer ?? row.value ?? row.selected ?? row.response ?? row.choice ?? "";
    if (!questionId && !questionText) {
      return [];
    }
    return [{
      question_id: questionId == null ? "" : String(questionId),
      question_text: questionText == null ? "" : String(questionText),
      answer: answer == null ? "" : String(answer)
    }];
  }

  function objectEntriesToRows(answers) {
    return Object.entries(answers).map(([questionId, answer]) => {
      if (answer && typeof answer === "object" && !Array.isArray(answer)) {
        return {
          question_id: String(questionId),
          question_text: String(answer.question || answer.questionText || answer.text || ""),
          answer: answer.answer == null ? "" : String(answer.answer)
        };
      }
      return {
        question_id: String(questionId),
        question_text: "",
        answer: answer == null ? "" : String(answer)
      };
    });
  }

  if (Array.isArray(payload)) {
    return payload.flatMap(normalizeAnswerRowObject);
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("JSON-filen skal indeholde svar i et understøttet format.");
  }
  if (payload.Answers && typeof payload.Answers === "object" && !Array.isArray(payload.Answers)) {
    return objectEntriesToRows(payload.Answers);
  }
  if (Array.isArray(payload.appStateAnswers)) {
    return payload.appStateAnswers.flatMap((row) => normalizeAnswerRowObject({
      questionID: row.questionID,
      questionText: row.questionText,
      value: row.value
    }));
  }
  if (payload.answers && typeof payload.answers === "object") {
    if (Array.isArray(payload.answers)) {
      return payload.answers.flatMap(normalizeAnswerRowObject);
    }
    return objectEntriesToRows(payload.answers);
  }
  if (payload.userAnswers && typeof payload.userAnswers === "object" && !Array.isArray(payload.userAnswers)) {
    return objectEntriesToRows(payload.userAnswers);
  }
  if (Array.isArray(payload.candidates) && payload.candidates.length === 1 && payload.candidates[0]?.answers) {
    return objectEntriesToRows(payload.candidates[0].answers);
  }
  if (payload.answers && Array.isArray(payload.answers)) {
    return payload.answers.flatMap(normalizeAnswerRowObject);
  }
  const directRows = normalizeAnswerRowObject(payload);
  if (directRows.length) {
    return directRows;
  }
  return objectEntriesToRows(payload);
}

function parseAnswerRows(text) {
  const cleaned = text.replace(/^\uFEFF/, "").trim();
  if (!cleaned) {
    throw new Error("Filen er tom.");
  }
  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    throw new Error("Upload en JSON-fil i et understøttet kandidattest-format.");
  }
  return parseJsonAnswerRows(cleaned);
}

function normalizeAnswerValue(rawValue) {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) {
    return null;
  }
  const sourceSlug = siteData.site_meta?.source_slug || "altinget";
  const normalizedLabel = trimmed.toLowerCase();
  const labelMap = sourceSlug === "tv2"
    ? {
        "helt uenig": -2,
        "meget uenig": -2,
        "uenig": -1,
        "neutral": 0,
        "enig": 1,
        "helt enig": 2,
        "meget enig": 2
      }
    : {
        "uenig": -2,
        "helt uenig": -2,
        "meget uenig": -2,
        "lidt uenig": -1,
        "delvist uenig": -1,
        "lidt enig": 1,
        "delvist enig": 1,
        "enig": 2,
        "helt enig": 2,
        "meget enig": 2
      };
  if (["spring over", "skipped", "skip"].includes(normalizedLabel)) {
    return null;
  }
  if (labelMap[normalizedLabel] !== undefined) {
    return labelMap[normalizedLabel];
  }
  const normalized = trimmed.replace(",", ".");
  const numericValue = Number(normalized);
  if (Number.isNaN(numericValue)) {
    throw new Error(`Ugyldigt svar "${trimmed}".`);
  }
  if (sourceSlug === "tv2" && [-2, -1, 0, 1, 2].includes(numericValue)) {
    return numericValue;
  }
  const mapped = siteData.model.answer_map[String(Math.trunc(numericValue))];
  if (mapped !== undefined && Number.isInteger(numericValue)) {
    return Number(mapped);
  }
  if ([-2, -1, 1, 2].includes(numericValue)) {
    return numericValue;
  }
  throw new Error(`Svaret "${trimmed}" er ikke understøttet.`);
}

function normalizeQuestionKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function labelFromFileName(fileName) {
  return String(fileName || "Profil").replace(/\.[^.]+$/, "").trim() || "Profil";
}

function upsertUploadedProfile(profile) {
  const nextProfiles = uploadedProfiles.filter((item) => item.label !== profile.label);
  nextProfiles.push(profile);
  uploadedProfiles = nextProfiles.sort((a, b) => a.label.localeCompare(b.label, "da"));
}

function removeUploadedProfile(label) {
  uploadedProfiles = uploadedProfiles.filter((profile) => profile.label !== label);
}

function renderUploadedProfilesList() {
  uploadProfilesEl.innerHTML = "";
  for (const profile of uploadedProfiles) {
    const item = document.createElement("div");
    item.className = "upload-profile-item";

    const copy = document.createElement("div");
    copy.className = "upload-profile-copy";

    const name = document.createElement("p");
    name.className = "upload-profile-name";
    name.textContent = profile.label;

    const meta = document.createElement("p");
    meta.className = "upload-profile-meta";
    meta.textContent = `PC1 ${formatNumber(profile.PC1)}, PC2 ${formatNumber(profile.PC2)}, PC3 ${formatNumber(profile.PC3)}, PC4 ${formatNumber(profile.PC4)}`;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "filter-button upload-profile-remove";
    removeButton.textContent = "Fjern";
    removeButton.addEventListener("click", () => {
      removeUploadedProfile(profile.label);
      setUploadButtonState();
      renderUploadedProfileStatus();
      renderCandidateCharts();
      renderCentroidCharts();
    });

    copy.append(name, meta);
    item.append(copy, removeButton);
    uploadProfilesEl.appendChild(item);
  }
}

function profileTrace(profile, xKey, yKey, xLabel, yLabel) {
  return {
    type: "scatter",
    mode: "markers+text",
    name: profile.label,
    x: [profile[xKey]],
    y: [profile[yKey]],
    text: [profile.label],
    textposition: "top center",
    textfont: {
      size: 12,
      color: "#201b17",
      family: "Avenir Next, Segoe UI, sans-serif"
    },
    marker: {
      size: 13,
      color: "#201b17",
      symbol: "star-diamond",
      line: { color: "#fffdf8", width: 1.4 }
    },
    hovertemplate:
      "<b>%{text}</b><br>" +
      `${xLabel}: %{x:.2f}<br>` +
      `${yLabel}: %{y:.2f}<br>` +
      "PC3: " + formatNumber(profile.PC3) + "<br>" +
      "PC4: " + formatNumber(profile.PC4) + "<extra></extra>"
  };
}

function projectUploadedAnswers(rows) {
  const questionIds = siteData.model.question_ids || [];
  const questionLookup = new Map();
  for (const question of siteData.model.questions || []) {
    const questionId = String(question.question_id || "");
    for (const label of [question.question, question.short_label]) {
      const normalized = normalizeQuestionKey(label);
      if (normalized) {
        questionLookup.set(normalized, questionId);
      }
    }
  }
  const lookup = new Map();
  for (const row of rows) {
    const rawQuestionId = String(row.question_id || "").trim();
    const questionId = rawQuestionId || questionLookup.get(normalizeQuestionKey(row.question_text)) || "";
    if (!questionId) {
      continue;
    }
    const normalizedAnswer = normalizeAnswerValue(row.answer);
    if (normalizedAnswer === null) {
      continue;
    }
    lookup.set(questionId, normalizedAnswer);
  }

  const answerVector = [];
  let answeredQuestions = 0;
  for (let index = 0; index < questionIds.length; index += 1) {
    const questionId = String(questionIds[index]);
    const answer = lookup.get(questionId);
    if (answer === undefined) {
      answerVector.push(Number(siteData.model.imputer_statistics[index]));
      continue;
    }
    answerVector.push(answer);
    answeredQuestions += 1;
  }

  if (!answeredQuestions) {
    throw new Error("Filen indeholder ingen gyldige svar.");
  }

  const standardized = answerVector.map((value, index) => {
    const scale = Number(siteData.model.scaler_scale[index]) || 1;
    return (value - Number(siteData.model.scaler_mean[index])) / scale;
  });
  const centered = standardized.map((value, index) => value - Number(siteData.model.pca_mean[index] || 0));
  const scores = siteData.model.pca_components.map((component) =>
    component.reduce((sum, weight, index) => sum + centered[index] * Number(weight), 0)
  );

  return {
    PC1: scores[0] || 0,
    PC2: scores[1] || 0,
    PC3: scores[2] || 0,
    PC4: scores[3] || 0,
    answeredQuestions
  };
}

function selectedMunicipalityRecord() {
  return siteData.municipalities.find((municipality) => municipality.name === selectedMunicipality) || null;
}

function relevantSmallConstituencies(row, municipality) {
  const rowScopes = Array.isArray(row.small_constituency_names) ? row.small_constituency_names : [];
  if (!municipality) {
    return rowScopes;
  }
  const allowedScopes = new Set(municipality.small_constituencies || []);
  return rowScopes.filter((scope) => allowedScopes.has(scope));
}

function formatBallotScopeForHover(row, municipality) {
  const scopes = relevantSmallConstituencies(row, municipality);
  if (!scopes.length) {
    return "Ikke oplyst";
  }
  return scopes.join(", ");
}

function titleWithMunicipality(title) {
  return selectedMunicipality === ALL_MUNICIPALITIES ? title : `${title} · ${selectedMunicipality}`;
}

function municipalityRows() {
  if (selectedMunicipality === ALL_MUNICIPALITIES) {
    return siteData.candidates;
  }
  const municipality = selectedMunicipalityRecord();
  if (!municipality) {
    return [];
  }
  return siteData.candidates.filter((row) => relevantSmallConstituencies(row, municipality).length > 0);
}

function municipalityBallotRows() {
  if (selectedMunicipality === ALL_MUNICIPALITIES) {
    return siteData.ballot_candidates;
  }
  const municipality = selectedMunicipalityRecord();
  if (!municipality) {
    return [];
  }
  return siteData.ballot_candidates.filter((row) => relevantSmallConstituencies(row, municipality).length > 0);
}

function visibleCandidateRows() {
  return municipalityRows().filter((row) => activeParties.has(row.party_name));
}

function buildCentroids(rows) {
  const grouped = groupBy(rows, "party_name");
  return Array.from(grouped.entries())
    .map(([partyName, partyRows]) => {
      const firstRow = partyRows[0];
      const pc1Values = partyRows.map((row) => row.PC1);
      const pc2Values = partyRows.map((row) => row.PC2);
      const pc3Values = partyRows.map((row) => row.PC3);
      const pc4Values = partyRows.map((row) => row.PC4);
      const pc1Sd = sampleStd(pc1Values);
      const pc2Sd = sampleStd(pc2Values);
      const pc3Sd = sampleStd(pc3Values);
      const pc4Sd = sampleStd(pc4Values);
      return {
        party_name: partyName,
        party_code: firstRow.party_code || "",
        candidate_count: partyRows.length,
        PC1: mean(pc1Values),
        PC2: mean(pc2Values),
        PC3: mean(pc3Values),
        PC4: mean(pc4Values),
        pc1_sd: pc1Sd,
        pc2_sd: pc2Sd,
        pc3_sd: pc3Sd,
        pc4_sd: pc4Sd,
        internal_dispersion: Math.sqrt(pc1Sd ** 2 + pc2Sd ** 2),
        color: firstRow.color
      };
    })
    .sort((a, b) => a.party_name.localeCompare(b.party_name, "da"));
}

function buildMunicipalityOptions(municipalities) {
  municipalitySelectEl.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = ALL_MUNICIPALITIES;
  allOption.textContent = "Alle kommuner";
  municipalitySelectEl.appendChild(allOption);

  for (const municipality of municipalities) {
    const option = document.createElement("option");
    option.value = municipality.name;
    option.textContent = municipality.name;
    municipalitySelectEl.appendChild(option);
  }
}

function buildPartyControls(parties) {
  filterEl.innerHTML = "";
  if (!parties.length) {
    const empty = document.createElement("p");
    empty.className = "table-empty";
    empty.textContent = "Ingen partier med PCA-kandidater i den valgte kommune.";
    filterEl.appendChild(empty);
    return;
  }
  for (const party of parties) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "party-toggle is-active";
    button.dataset.party = party.party_name;
    const dot = document.createElement("span");
    dot.className = "party-dot";
    dot.style.background = party.color;
    const label = document.createElement("span");
    label.textContent = `${party.party_code || "?"} ${party.party_name}`;
    button.append(dot, label);
    button.addEventListener("click", () => {
      if (activeParties.has(party.party_name)) {
        activeParties.delete(party.party_name);
        button.classList.remove("is-active");
      } else {
        activeParties.add(party.party_name);
        button.classList.add("is-active");
      }
      renderCandidateCharts();
      renderCentroidCharts();
    });
    filterEl.appendChild(button);
  }
}

function candidateTrace(partyName, rows, xKey, yKey, xLabel, yLabel) {
  return {
    type: "scattergl",
    mode: "markers",
    name: partyName,
    x: rows.map((row) => row[xKey]),
    y: rows.map((row) => row[yKey]),
    marker: {
      size: 8,
      color: rows[0].color,
      opacity: 0.74,
      line: { width: 0 }
    },
    customdata: rows.map((row) => [
      row.name,
      row.party_name,
      row.party_code,
      row.PC3,
      row.PC4
    ]),
    hovertemplate:
      "<b>%{customdata[0]}</b><br>" +
      "%{customdata[2]} · %{customdata[1]}<br>" +
      `${xLabel}: %{x:.2f}<br>` +
      `${yLabel}: %{y:.2f}<br>` +
      "PC3: %{customdata[3]:.2f}<br>" +
      "PC4: %{customdata[4]:.2f}<extra></extra>"
  };
}

function partyLeaderTrace(rows, xKey, yKey, xLabel, yLabel) {
  return {
    type: "scatter",
    mode: "markers",
    name: "Partiformænd",
    x: rows.map((row) => row[xKey]),
    y: rows.map((row) => row[yKey]),
    marker: {
      size: 16,
      color: rows.map((row) => row.color),
      symbol: "circle-open",
      line: { color: "#201b17", width: 2.2 }
    },
    customdata: rows.map((row) => [
      row.name,
      row.party_name,
      row.party_code,
      row.PC3,
      row.PC4
    ]),
    hovertemplate:
      "<b>Partiformand</b><br>" +
      "%{customdata[2]} · %{customdata[1]}<br>" +
      "%{customdata[0]}<br>" +
      `${xLabel}: %{x:.2f}<br>` +
      `${yLabel}: %{y:.2f}<br>` +
      "PC3: %{customdata[3]:.2f}<br>" +
      "PC4: %{customdata[4]:.2f}<extra></extra>"
  };
}

function centroidTrace(rows, xKey, yKey, xSdKey, ySdKey, xLabel, yLabel) {
  const textPositionByCode = {
    "A": "top right",
    "B": "top left",
    "C": "top center",
    "F": "top left",
    "H": "top left",
    "I": "top right",
    "M": "top center",
    "O": "top center",
    "V": "top left",
    "\u00c6": "top right",
    "\u00d8": "top left",
    "\u00c5": "top center",
    "": "top center"
  };
  return {
    type: "scatter",
    mode: "markers+text",
    x: rows.map((row) => row[xKey]),
    y: rows.map((row) => row[yKey]),
    text: rows.map((row) => row.party_code || "?"),
    textposition: rows.map((row) => textPositionByCode[row.party_code || ""] || "top center"),
    textfont: {
      size: 16,
      color: "#201b17",
      family: "Avenir Next, Segoe UI, sans-serif"
    },
    marker: {
      size: 18,
      color: rows.map((row) => row.color),
      line: { color: "#201b17", width: 1 }
    },
    error_x: {
      type: "data",
      array: rows.map((row) => row[xSdKey] || 0),
      visible: true,
      thickness: 1.4,
      width: 0,
      color: "rgba(32,27,23,0.4)"
    },
    error_y: {
      type: "data",
      array: rows.map((row) => row[ySdKey] || 0),
      visible: true,
      thickness: 1.4,
      width: 0,
      color: "rgba(32,27,23,0.4)"
    },
    customdata: rows.map((row) => [
      row.party_name,
      row.party_code,
      row.candidate_count,
      row.internal_dispersion,
      row[xSdKey] || 0,
      row[ySdKey] || 0
    ]),
    hovertemplate:
      "<b>%{customdata[1]} · %{customdata[0]}</b><br>" +
      `${xLabel}: %{x:.2f}<br>` +
      `${yLabel}: %{y:.2f}<br>` +
      `Spredning ${xLabel}: %{customdata[4]:.2f}<br>` +
      `Spredning ${yLabel}: %{customdata[5]:.2f}<br>` +
      "Kandidater i PCA: %{customdata[2]}<br>" +
      "Intern spredning: %{customdata[3]:.2f}<extra></extra>"
  };
}

function baseLayout(title, xTitle, yTitle, xKey, yKey) {
  const ranges = currentAxisRanges(xKey, yKey);
  return {
    title: { text: title, x: 0.02, xanchor: "left", font: { family: "Iowan Old Style, Georgia, serif", size: 22, color: "#201b17" } },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    margin: { l: 58, r: 24, t: 56, b: 56 },
    xaxis: {
      title: xTitle,
      range: ranges ? ranges.x : undefined,
      zeroline: true,
      zerolinecolor: "rgba(32,27,23,0.25)",
      gridcolor: "rgba(32,27,23,0.09)",
      autorange: false
    },
    yaxis: {
      title: yTitle,
      range: ranges ? ranges.y : undefined,
      zeroline: true,
      zerolinecolor: "rgba(32,27,23,0.25)",
      gridcolor: "rgba(32,27,23,0.09)",
      autorange: false
    },
    showlegend: false,
    hoverlabel: {
      bgcolor: "#fffdf8",
      bordercolor: "#d9d3ca",
      font: { color: "#201b17" },
      align: "left"
    }
  };
}

function computeAxisRangePair(xKey, yKey) {
  const xs = siteData.candidates.map((row) => row[xKey]);
  const ys = siteData.candidates.map((row) => row[yKey]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xPad = Math.max((xMax - xMin) * 0.08, 0.5);
  const yPad = Math.max((yMax - yMin) * 0.08, 0.5);
  return {
    x: [xMin - xPad, xMax + xPad],
    y: [yMin - yPad, yMax + yPad]
  };
}

function computeAxisRanges() {
  axisRanges = {
    PC1_PC2: computeAxisRangePair("PC1", "PC2"),
    PC3_PC4: computeAxisRangePair("PC3", "PC4")
  };
}

function emptyStateLayout(title, message, xTitle, yTitle, xKey, yKey) {
  const layout = baseLayout(titleWithMunicipality(title), xTitle, yTitle, xKey, yKey);
  layout.annotations = [
    {
      text: message,
      x: 0.5,
      y: 0.5,
      xref: "paper",
      yref: "paper",
      showarrow: false,
      font: { size: 16, color: "#6f655d" }
    }
  ];
  return layout;
}

function updateScopeCopy() {
  if (selectedMunicipality === ALL_MUNICIPALITIES) {
    partySectionCopyEl.textContent = "Tabellerne viser partiernes gennemsnitlige placering i PCA-rummet og hvilke partier der spænder mest internt på landsplan.";
    figureSectionCopyEl.textContent = "De vigtigste PCA-figurer er gjort interaktive. Filtrér partier, vælg kommune, upload dine egne svar, og hold musen over en kandidat for at se navn, parti og placering.";
    return;
  }
  partySectionCopyEl.textContent = `Tabellerne viser partiernes gennemsnitlige placering og interne spænd blandt kandidater i området omkring ${selectedMunicipality}.`;
  figureSectionCopyEl.textContent = `De interaktive figurer viser kun kandidater i området omkring ${selectedMunicipality} og kan suppleres med din egen profil.`;
}

function updateMunicipalitySummary(rows, centroids) {
  if (selectedMunicipality === ALL_MUNICIPALITIES) {
    municipalitySummaryEl.textContent = `Viser hele landet: ${rows.length} kandidater i PCA fordelt på ${centroids.length} partier.`;
    return;
  }
  const municipality = selectedMunicipalityRecord();
  const bigConstituency = municipality?.big_constituency_name || "ukendt område";
  municipalitySummaryEl.textContent = `Viser ${selectedMunicipality}: ${rows.length} kandidater i PCA fordelt på ${centroids.length} partier. Området hører til ${bigConstituency}.`;
}

function createTable(container, columns, rows, emptyMessage = "Ingen rækker at vise.") {
  container.innerHTML = "";

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "table-empty";
    empty.textContent = emptyMessage;
    container.appendChild(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "data-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const column of columns) {
    const th = document.createElement("th");
    th.textContent = column.label;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const column of columns) {
      const td = document.createElement("td");
      const value = row[column.key];
      td.textContent = column.format ? column.format(value, row) : String(value ?? "");
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

function renderPartyTables() {
  const centroids = buildCentroids(municipalityRows());
  const partyColumns = [
    { key: "party_code", label: "Kode" },
    { key: "party_name", label: "Parti" },
    { key: "candidate_count", label: "Kandidater" }
  ];
  createTable(
    tablePc1NegEl,
    [...partyColumns, { key: "PC1", label: "PC1", format: (value) => formatNumber(value) }],
    centroids.slice().sort((a, b) => a.PC1 - b.PC1).slice(0, TABLE_LIMIT)
  );
  createTable(
    tablePc1PosEl,
    [...partyColumns, { key: "PC1", label: "PC1", format: (value) => formatNumber(value) }],
    centroids.slice().sort((a, b) => b.PC1 - a.PC1).slice(0, TABLE_LIMIT)
  );
  createTable(
    tablePc2NegEl,
    [...partyColumns, { key: "PC2", label: "PC2", format: (value) => formatNumber(value) }],
    centroids.slice().sort((a, b) => a.PC2 - b.PC2).slice(0, TABLE_LIMIT)
  );
  createTable(
    tablePc2PosEl,
    [...partyColumns, { key: "PC2", label: "PC2", format: (value) => formatNumber(value) }],
    centroids.slice().sort((a, b) => b.PC2 - a.PC2).slice(0, TABLE_LIMIT)
  );
  createTable(
    tableDispersionEl,
    [...partyColumns, { key: "internal_dispersion", label: "Spredning", format: (value) => formatNumber(value) }],
    centroids.slice().sort((a, b) => b.internal_dispersion - a.internal_dispersion).slice(0, Math.max(TABLE_LIMIT + 3, centroids.length)),
    "Ingen partier at vise for den valgte kommune."
  );
}

function renderCandidateTable() {
  if (selectedMunicipality === ALL_MUNICIPALITIES) {
    createTable(
      tableCandidatesEl,
      [],
      [],
      "Vælg en kommune for at se de kandidater, der hører til det valgte område."
    );
    return;
  }

  const municipality = selectedMunicipalityRecord();
  const rows = municipalityBallotRows()
    .map((row) => ({
      ...row,
      municipality_scope: relevantSmallConstituencies(row, municipality).join(", ")
    }))
    .sort(
      (a, b) =>
        a.party_name.localeCompare(b.party_name, "da") ||
        a.name.localeCompare(b.name, "da")
    );

  createTable(
    tableCandidatesEl,
    [
      { key: "party_code", label: "Kode" },
      { key: "party_name", label: "Parti" },
      { key: "name", label: "Kandidat" },
      { key: "nomination_constituency", label: "Nominationskreds", format: (value) => value || "Ikke oplyst" },
      { key: "municipality_scope", label: "Område", format: (value) => value || "Ikke oplyst" }
    ],
    rows,
    "Ingen kandidater fundet for den valgte kommune."
  );
}

function renderUploadedProfileStatus() {
  if (!uploadedProfiles.length) {
    updateUploadStatus("Ingen profiler uploadet endnu.");
    renderUploadedProfilesList();
    return;
  }
  const label = uploadedProfiles.length === 1 ? "profil" : "profiler";
  updateUploadStatus(`${uploadedProfiles.length} ${label} er lagt ind i kompasset.`, "is-success");
  renderUploadedProfilesList();
}

async function handleAnswersUpload(files) {
  const addedLabels = [];
  const errors = [];
  for (const file of files) {
    try {
      const rawText = await file.text();
      const parsedRows = parseAnswerRows(rawText);
      const profile = projectUploadedAnswers(parsedRows);
      upsertUploadedProfile({
        ...profile,
        label: labelFromFileName(file.name)
      });
      addedLabels.push(labelFromFileName(file.name));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Kunne ikke læse svarfilen.";
      errors.push(`${file.name}: ${message}`);
    }
  }
  setUploadButtonState();
  renderUploadedProfileStatus();
  renderCandidateCharts();
  renderCentroidCharts();
  answersUploadInputEl.value = "";

  if (errors.length) {
    updateUploadStatus(errors.join(" | "), "is-error");
    renderUploadedProfilesList();
    return;
  }

  if (addedLabels.length) {
    const uploadedLabel = addedLabels.length === 1 ? "profil" : "profiler";
    updateUploadStatus(`${addedLabels.length} ${uploadedLabel} indlæst: ${addedLabels.join(", ")}.`, "is-success");
    renderUploadedProfilesList();
  }
}

function renderCandidateChart(chartEl, xKey, yKey, title, xTitle, yTitle) {
  const grouped = groupBy(visibleCandidateRows(), "party_name");
  const traces = Array.from(grouped.entries())
    .sort((a, b) => a[0].localeCompare(b[0], "da"))
    .map(([partyName, rows]) => candidateTrace(partyName, rows, xKey, yKey, xKey, yKey));
  const partyLeaderRows = visibleCandidateRows().filter((row) => row.is_party_leader);
  if (partyLeaderRows.length) {
    traces.push(partyLeaderTrace(partyLeaderRows, xKey, yKey, xKey, yKey));
  }
  traces.push(...uploadedProfiles.map((profile) => profileTrace(profile, xKey, yKey, xKey, yKey)));
  const layout = traces.length
    ? baseLayout(
        titleWithMunicipality(title),
        xTitle,
        yTitle,
        xKey,
        yKey
      )
    : emptyStateLayout(
        title,
        uploadedProfiles.length
          ? "Profilerne vises alene, fordi alle partier er skjult i den aktuelle visning."
          : "Vælg mindst ét parti for at vise kandidaterne i den valgte kommune.",
        xTitle,
        yTitle,
        xKey,
        yKey
      );

  Plotly.react(
    chartEl,
    traces,
    layout,
    { responsive: true, displayModeBar: false }
  );
}

function renderCandidateCharts() {
  renderCandidateChart(
    candidateChartEl,
    "PC1",
    "PC2",
    "Kandidater farvet efter parti",
    `PC1 (${siteData.summary.pc1_pct.toFixed(1)}% forklaret variation)`,
    `PC2 (${siteData.summary.pc2_pct.toFixed(1)}% forklaret variation)`
  );
  renderCandidateChart(
    candidateChart34El,
    "PC3",
    "PC4",
    "Kandidater farvet efter parti",
    "PC3",
    "PC4"
  );
}

function renderCentroidChart(chartEl, xKey, yKey, xSdKey, ySdKey, title, xTitle, yTitle) {
  const rows = buildCentroids(visibleCandidateRows());
  const traces = rows.length ? [centroidTrace(rows, xKey, yKey, xSdKey, ySdKey, xKey, yKey)] : [];
  traces.push(...uploadedProfiles.map((profile) => profileTrace(profile, xKey, yKey, xKey, yKey)));
  const layout = traces.length
    ? baseLayout(
        titleWithMunicipality(title),
        xTitle,
        yTitle,
        xKey,
        yKey
      )
    : emptyStateLayout(
        title,
        uploadedProfiles.length
          ? "Profilerne vises alene, fordi alle partier er skjult i den aktuelle visning."
          : "Vælg mindst ét parti for at vise particentroiderne i den valgte kommune.",
        xTitle,
        yTitle,
        xKey,
        yKey
      );
  Plotly.react(
    chartEl,
    traces,
    layout,
    { responsive: true, displayModeBar: false }
  );
}

function renderCentroidCharts() {
  renderCentroidChart(
    centroidChartEl,
    "PC1",
    "PC2",
    "pc1_sd",
    "pc2_sd",
    "Partiernes gennemsnitlige placering",
    `PC1 (${siteData.summary.pc1_pct.toFixed(1)}%)`,
    `PC2 (${siteData.summary.pc2_pct.toFixed(1)}%)`
  );
  renderCentroidChart(
    centroidChart34El,
    "PC3",
    "PC4",
    "pc3_sd",
    "pc4_sd",
    "Partiernes gennemsnitlige placering",
    `PC3 (${siteData.summary.pc3_pct.toFixed(1)}%)`,
    `PC4 (${siteData.summary.pc4_pct.toFixed(1)}%)`
  );
}

function renderExplainedVarianceChart() {
  const rows = siteData.variance || [];
  const traces = [
    {
      type: "bar",
      x: rows.map((row) => row.component),
      y: rows.map((row) => row.explained_variance_pct),
      marker: { color: "#457b9d" },
      name: "Komponent",
      hovertemplate: "<b>%{x}</b><br>Forklaret variation: %{y:.1f}%<extra></extra>"
    },
    {
      type: "scatter",
      mode: "lines+markers",
      x: rows.map((row) => row.component),
      y: rows.map((row) => row.cumulative_explained_variance_pct),
      yaxis: "y2",
      line: { color: "#0f766e", width: 2.5 },
      marker: { color: "#0f766e", size: 8 },
      name: "Kumulativ",
      hovertemplate: "<b>%{x}</b><br>Kumulativ variation: %{y:.1f}%<extra></extra>"
    }
  ];

  Plotly.react(
    explainedVarianceChartEl,
    traces,
    {
      paper_bgcolor: "#ffffff",
      plot_bgcolor: "#ffffff",
      margin: { l: 58, r: 58, t: 24, b: 50 },
      xaxis: {
        title: "",
        gridcolor: "rgba(32,27,23,0.09)"
      },
      yaxis: {
        title: "Forklaret variation (%)",
        rangemode: "tozero",
        gridcolor: "rgba(32,27,23,0.09)"
      },
      yaxis2: {
        title: "Kumulativ (%)",
        overlaying: "y",
        side: "right",
        range: [0, 100]
      },
      legend: {
        orientation: "h",
        y: 1.06,
        x: 0.02
      },
      hoverlabel: {
        bgcolor: "#fffdf8",
        bordercolor: "#d9d3ca",
        font: { color: "#201b17" }
      }
    },
    { responsive: true, displayModeBar: false }
  );
}

function syncPartyControls(resetActive = false) {
  const parties = buildCentroids(municipalityRows());
  if (resetActive) {
    activeParties = new Set(parties.map((party) => party.party_name));
  } else {
    const available = new Set(parties.map((party) => party.party_name));
    activeParties = new Set(Array.from(activeParties).filter((party) => available.has(party)));
    if (!activeParties.size) {
      activeParties = new Set(parties.map((party) => party.party_name));
    }
  }
  buildPartyControls(parties);
}

function renderAll() {
  const rows = municipalityRows();
  const centroids = buildCentroids(rows);
  updateMunicipalitySummary(rows, centroids);
  updateScopeCopy();
  renderPartyTables();
  renderCandidateTable();
  renderCandidateCharts();
  renderCentroidCharts();
}

function boot() {
  siteData = window.__SITE_DATA__;
  if (!siteData) {
    throw new Error("Missing embedded site data.");
  }

  computeAxisRanges();
  buildMunicipalityOptions(siteData.municipalities.slice().sort((a, b) => a.name.localeCompare(b.name, "da")));
  syncPartyControls(true);
  renderExplainedVarianceChart();
  renderUploadedProfileStatus();
  setUploadButtonState();

  municipalitySelectEl.addEventListener("change", () => {
    selectedMunicipality = municipalitySelectEl.value;
    syncPartyControls(true);
    renderAll();
  });

  answersUploadInputEl.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) {
      return;
    }
    updateUploadStatus(`Indlæser ${files.length} fil${files.length === 1 ? "" : "er"} ...`);
    await handleAnswersUpload(files);
  });

  clearUploadButtonEl.addEventListener("click", () => {
    uploadedProfiles = [];
    answersUploadInputEl.value = "";
    setUploadButtonState();
    renderUploadedProfileStatus();
    renderCandidateCharts();
    renderCentroidCharts();
  });

  document.querySelector('[data-filter-action="all"]').addEventListener("click", () => {
    activeParties = new Set(buildCentroids(municipalityRows()).map((party) => party.party_name));
    document.querySelectorAll(".party-toggle").forEach((el) => el.classList.add("is-active"));
    renderCandidateCharts();
    renderCentroidCharts();
  });

  document.querySelector('[data-filter-action="none"]').addEventListener("click", () => {
    activeParties = new Set();
    document.querySelectorAll(".party-toggle").forEach((el) => el.classList.remove("is-active"));
    renderCandidateCharts();
    renderCentroidCharts();
  });

  renderAll();
}

boot();
