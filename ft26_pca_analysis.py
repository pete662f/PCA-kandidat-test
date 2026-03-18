from __future__ import annotations

import concurrent.futures
import dataclasses
import html
import json
import os
import pathlib
import re
import textwrap
import warnings
from datetime import date
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import requests
import seaborn as sns
from requests.adapters import HTTPAdapter
from sklearn.decomposition import PCA
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from urllib3.util.retry import Retry


API_BASE = "https://api.altinget.dk/vaa-api"
API_KEY_ENV_VAR = "ALTINGET_API_KEY"
ENV_FILE = pathlib.Path(".env")
ELECTION_ID = 13
VALGOMAT_ID = 15
MIN_ANSWERED_QUESTIONS = 20
PCA_COMPONENTS = 4
MAX_WORKERS = 12
TOP_N_SUMMARY_ROWS = 5
OUT_DIR = pathlib.Path("output/ft26_pca")
RAW_DIR = OUT_DIR / "raw"
DATA_DIR = OUT_DIR / "data"
FIG_DIR = OUT_DIR / "figures"
SITE_DIR = OUT_DIR / "site"

ANSWER_MAP = {
    1: -2.0,
    2: -1.0,
    4: 1.0,
    5: 2.0,
}

MUNICIPALITY_SMALL_CONSTITUENCY_HINTS: dict[int, list[str]] = {
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
}

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning, message="Tight layout not applied.*")


@dataclasses.dataclass
class Election:
    ID: int
    Prefix: str
    Name: str
    valgomat_id: int


def load_dotenv(env_path: pathlib.Path = ENV_FILE) -> None:
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if key and key not in os.environ:
            os.environ[key] = value


def get_api_key() -> str:
    load_dotenv()
    api_key = os.environ.get(API_KEY_ENV_VAR, "").strip()
    if not api_key:
        raise RuntimeError(
            f"Missing API key. Set {API_KEY_ENV_VAR} in the environment or add it to {ENV_FILE}."
        )
    return api_key


def make_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=5,
        connect=5,
        read=5,
        backoff_factor=0.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET", "POST"),
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update(
        {
            "authorization": get_api_key(),
            "referer": "https://www.altinget.dk/",
            "user-agent": "Mozilla/5.0",
        }
    )
    return session


def api_get(session: requests.Session, path: str, **params: Any) -> Any:
    response = session.get(f"{API_BASE}{path}", params=params, timeout=30)
    response.raise_for_status()
    return response.json()


def strip_html(raw: str | None) -> str | None:
    if raw is None:
        return None
    text = re.sub(r"<[^>]+>", " ", raw)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def ensure_dirs() -> None:
    for directory in (RAW_DIR, DATA_DIR, FIG_DIR, SITE_DIR):
        directory.mkdir(parents=True, exist_ok=True)


def split_pipe_names(raw: Any) -> list[str]:
    if raw is None or pd.isna(raw):
        return []
    return [item.strip() for item in str(raw).split(" | ") if item.strip()]


def build_municipality_payload(
    municipalities: list[dict[str, Any]],
    big_constituencies: list[dict[str, Any]],
    small_constituencies: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    big_lookup = {int(item["ID"]): (item.get("Name") or "").strip() for item in big_constituencies}
    small_names = [(item.get("Name") or "").strip() for item in small_constituencies]
    payload = []
    missing_mappings = []
    unresolved_names = []

    for municipality in sorted(municipalities, key=lambda item: (item.get("Name") or "").strip()):
        name = (municipality.get("Name") or "").strip()
        kmd_id = int(municipality.get("ID_KMD") or 0)
        short_names = MUNICIPALITY_SMALL_CONSTITUENCY_HINTS.get(kmd_id)
        if not short_names:
            missing_mappings.append(name)
            continue

        resolved_smalls = []
        for short_name in short_names:
            matches = sorted({small_name for small_name in small_names if short_name in small_name})
            if len(matches) != 1:
                unresolved_names.append((name, short_name, matches))
                continue
            resolved_smalls.append(matches[0])

        payload.append(
            {
                "name": name,
                "kmd_id": kmd_id,
                "big_constituency_name": big_lookup.get(int(municipality.get("ID_BigConstituency") or 0), ""),
                "small_constituencies": sorted(dict.fromkeys(resolved_smalls)),
            }
        )

    if missing_mappings or unresolved_names:
        parts = []
        if missing_mappings:
            parts.append("mangler mapping for " + ", ".join(sorted(missing_mappings)))
        if unresolved_names:
            rendered = "; ".join(
                f"{municipality} -> {short_name} ({', '.join(matches) or 'ingen match'})"
                for municipality, short_name, matches in unresolved_names
            )
            parts.append("kunne ikke mappe opstillingskredse: " + rendered)
        raise RuntimeError("Kommunefiltrering kunne ikke bygges: " + " | ".join(parts))

    return payload


def fetch_election_metadata(session: requests.Session) -> tuple[Election, list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    elections = api_get(session, "/v1/GetElections")
    election = next(item for item in elections if item["ID"] == ELECTION_ID)
    valgomats = api_get(session, "/v1/GetValgomats", electionId=ELECTION_ID, frontpage=True)
    valgomat = next(item for item in valgomats if item["ID"] == VALGOMAT_ID)
    big_constituencies = api_get(session, "/v1/GetBigConstituencies")
    small_constituencies = api_get(session, "/v1/GetSmallConstituencies")
    municipalities = api_get(session, "/v1/GetMunicipalities")
    return (
        Election(
            ID=election["ID"],
            Prefix=election["Prefix"],
            Name=election["Name"],
            valgomat_id=valgomat["ID"],
        ),
        big_constituencies,
        small_constituencies,
        municipalities,
    )


def fetch_questions(session: requests.Session, big_group_id: int) -> list[dict[str, Any]]:
    payload = api_get(
        session,
        "/v2/GetQuestions",
        electionId=ELECTION_ID,
        valgomatId=VALGOMAT_ID,
        groupId=big_group_id,
        frontpage="true",
    )
    questions: list[dict[str, Any]] = []
    for row in payload:
        questions.append(
            {
                "question_id": int(row["Id"]),
                "topic": strip_html(row.get("Title")),
                "question": strip_html(row.get("Question")),
                "elaboration": strip_html(row.get("Info")),
                "argument_for": strip_html(row.get("ArgumentFor")),
                "argument_against": strip_html(row.get("ArgumentAgainst")),
                "question_type": row.get("QuestionType"),
                "is_topic_question_type": bool(row.get("IsTopicQuestionType")),
                "big_group_id": big_group_id,
            }
        )
    return questions


def fetch_ballot_list(session: requests.Session, small_group_id: int) -> list[dict[str, Any]]:
    payload = api_get(session, "/v1/GetBallotList", electionId=ELECTION_ID, groupId=small_group_id)
    return payload["BallotCandidates"]


def fetch_candidate_answers(session: requests.Session, candidate_id: int, big_group_id: int) -> list[dict[str, Any]]:
    return api_get(
        session,
        "/v1/GetCandidateAnswers",
        candidateId=candidate_id,
        electionId=ELECTION_ID,
        valgomatId=VALGOMAT_ID,
        groupId=big_group_id,
        frontpage="true",
    )


def fetch_candidate_info(session: requests.Session, candidate_id: int) -> dict[str, Any] | None:
    payload = api_get(session, "/v1/GetCandidate", candidateId=candidate_id, electionId=ELECTION_ID)
    return payload[0] if payload else None


def prepare_questions(
    session: requests.Session,
    big_constituencies: list[dict[str, Any]],
) -> tuple[pd.DataFrame, pd.DataFrame]:
    by_group: dict[int, list[dict[str, Any]]] = {}
    for group in big_constituencies:
        by_group[int(group["ID"])] = fetch_questions(session, int(group["ID"]))

    (RAW_DIR / "questions_by_big_constituency.json").write_text(
        json.dumps(by_group, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    question_sets = {group_id: {item["question_id"] for item in rows} for group_id, rows in by_group.items()}
    if not question_sets:
        raise ValueError("No question sets were returned from the API.")
    common_ids = sorted(set.intersection(*question_sets.values()))
    first_group_id = min(by_group)
    canonical_lookup = {item["question_id"]: item for item in by_group[first_group_id]}

    question_rows = []
    for question_id in common_ids:
        item = canonical_lookup[question_id]
        question_rows.append(
            {
                "question_id": question_id,
                "topic": item["topic"],
                "question": item["question"],
                "short_label": f"{item['topic']}: {item['question']}",
            }
        )

    questions_df = pd.DataFrame(question_rows).sort_values("question_id").reset_index(drop=True)
    questions_df.to_csv(DATA_DIR / "questions_common.csv", index=False)

    consistency_rows = [
        {
            "big_group_id": group_id,
            "question_count": len(question_ids),
            "common_question_count": len(common_ids),
            "same_as_common_set": question_ids == set(common_ids),
        }
        for group_id, question_ids in sorted(question_sets.items())
    ]
    consistency_df = pd.DataFrame(consistency_rows)
    consistency_df.to_csv(DATA_DIR / "question_set_consistency.csv", index=False)
    return questions_df, consistency_df


def prepare_candidates(
    session: requests.Session,
    small_constituencies: list[dict[str, Any]],
) -> tuple[pd.DataFrame, dict[int, int]]:
    small_lookup = {int(item["ID"]): item for item in small_constituencies}
    by_candidate: dict[int, dict[str, Any]] = {}
    candidate_big_group: dict[int, int] = {}

    raw_ballots: dict[int, list[dict[str, Any]]] = {}
    for small in small_constituencies:
        small_id = int(small["ID"])
        rows = fetch_ballot_list(session, small_id)
        raw_ballots[small_id] = rows
        for row in rows:
            candidate_id = int(row["candidateId"])
            big_group_id = int(small["ID_BigConstituency"])
            candidate_big_group[candidate_id] = big_group_id
            current = by_candidate.setdefault(
                candidate_id,
                {
                    "candidate_id": candidate_id,
                    "name": row["name"],
                    "party_id": int(row["partyId"]),
                    "party_code": row["partyCode"] or "",
                    "party_name": row["partyName"],
                    "url_key": row["urlKey"],
                    "small_constituency_ids": set(),
                    "small_constituency_names": set(),
                    "big_constituency_id": big_group_id,
                },
            )
            current["small_constituency_ids"].add(small_id)
            current["small_constituency_names"].add(small["Name"])

    (RAW_DIR / "ballot_lists_by_small_constituency.json").write_text(
        json.dumps(raw_ballots, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        info_lookup = {
            candidate_id: info
            for candidate_id, info in zip(
                by_candidate,
                pool.map(lambda cid: fetch_candidate_info(session, cid), by_candidate),
            )
        }

    candidate_rows = []
    for candidate_id, candidate in by_candidate.items():
        info = info_lookup.get(candidate_id) or {}
        lineups = info.get("LineUps") or []
        primary_small = next(
            (
                lineup
                for lineup in lineups
                if lineup.get("groupType") == "SmallConstituency"
                and str(lineup.get("listPriorityNumber") or "").strip() == "1"
            ),
            None,
        )
        big_lineup = next((lineup for lineup in lineups if lineup.get("groupType") == "Bigconstituency"), None)
        candidate_rows.append(
            {
                "candidate_id": candidate_id,
                "name": candidate["name"],
                "firstname": info.get("Firstname"),
                "lastname": info.get("LastName"),
                "party_id": candidate["party_id"],
                "party_code": candidate["party_code"],
                "party_name": candidate["party_name"],
                "current_party_code": info.get("CurrentPartyCode") or candidate["party_code"],
                "current_party_name": info.get("CurrentParty") or candidate["party_name"],
                "city": (info.get("City") or "").strip() or None,
                "profession": info.get("Profession"),
                "education": info.get("Education"),
                "gender": info.get("Gender"),
                "birthdate": info.get("Birthdate"),
                "url_key": candidate["url_key"],
                "big_constituency_id": candidate["big_constituency_id"],
                "big_constituency_name": big_lineup.get("lineUpName") if big_lineup else None,
                "nomination_constituency": primary_small.get("lineUpName") if primary_small else None,
                "small_constituency_count": len(candidate["small_constituency_ids"]),
                "small_constituency_names": " | ".join(sorted(candidate["small_constituency_names"])),
            }
        )

    candidates_df = pd.DataFrame(candidate_rows).sort_values(["big_constituency_id", "party_code", "name"]).reset_index(drop=True)
    candidates_df.to_csv(DATA_DIR / "candidates.csv", index=False)
    return candidates_df, candidate_big_group


def prepare_answers(
    session: requests.Session,
    candidates_df: pd.DataFrame,
    candidate_big_group: dict[int, int],
    question_ids: list[int],
) -> pd.DataFrame:
    candidate_ids = candidates_df["candidate_id"].tolist()

    def fetch_one(candidate_id: int) -> tuple[int, list[dict[str, Any]]]:
        return candidate_id, fetch_candidate_answers(session, candidate_id, candidate_big_group[candidate_id])

    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        answer_payloads = dict(pool.map(fetch_one, candidate_ids))

    (RAW_DIR / "candidate_answers.json").write_text(
        json.dumps(answer_payloads, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    long_rows = []
    for candidate_id, rows in answer_payloads.items():
        for row in rows:
            question_id = int(row["QuestionID"])
            if question_id not in question_ids:
                continue
            raw_answer = int(row["Answer"] or 0)
            long_rows.append(
                {
                    "candidate_id": candidate_id,
                    "question_id": question_id,
                    "raw_answer": raw_answer,
                    "mapped_answer": ANSWER_MAP.get(raw_answer, np.nan),
                    "is_important": int(row.get("IsImportant") or 0),
                    "comment": (row.get("Info") or "").strip() or None,
                }
            )

    answers_long = pd.DataFrame(long_rows)
    answers_long.to_csv(DATA_DIR / "answers_long.csv", index=False)

    answers_wide = answers_long.pivot(index="candidate_id", columns="question_id", values="mapped_answer")
    answers_wide = answers_wide.reindex(columns=question_ids)
    answers_wide.to_csv(DATA_DIR / "answers_wide.csv")
    return answers_wide


def run_pca(
    candidates_df: pd.DataFrame,
    answers_wide: pd.DataFrame,
    questions_df: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    answered_counts = answers_wide.notna().sum(axis=1)
    retained_ids = answered_counts[answered_counts >= MIN_ANSWERED_QUESTIONS].index
    retained_matrix = answers_wide.loc[retained_ids]
    if len(retained_ids) < PCA_COMPONENTS or retained_matrix.shape[1] < PCA_COMPONENTS:
        raise ValueError(
            "Not enough retained candidates or shared questions to compute the configured number of PCA components."
        )

    pipeline = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="mean")),
            ("scaler", StandardScaler()),
            ("pca", PCA(n_components=PCA_COMPONENTS, random_state=0)),
        ]
    )
    scores = pipeline.fit_transform(retained_matrix)
    pca = pipeline.named_steps["pca"]
    scaler = pipeline.named_steps["scaler"]
    imputer = pipeline.named_steps["imputer"]

    retained_candidates = candidates_df.set_index("candidate_id").loc[retained_ids].reset_index()
    score_columns = [f"PC{i + 1}" for i in range(scores.shape[1])]
    scores_df = retained_candidates.copy()
    for idx, column in enumerate(score_columns):
        scores_df[column] = scores[:, idx]
    scores_df["answered_questions"] = answered_counts.loc[retained_ids].values
    scores_df["imputed_questions"] = len(questions_df) - scores_df["answered_questions"]
    scores_df.to_csv(DATA_DIR / "candidate_pca_scores.csv", index=False)

    loadings = pca.components_.T * np.sqrt(pca.explained_variance_)
    loadings_df = questions_df.copy()
    for idx, column in enumerate(score_columns):
        loadings_df[column] = loadings[:, idx]
    loadings_df["question_mean_mapped"] = imputer.statistics_
    loadings_df["question_scale_sd"] = scaler.scale_
    loadings_df.to_csv(DATA_DIR / "question_loadings.csv", index=False)

    party_centroids = (
        scores_df.groupby(["party_code", "party_name"], dropna=False)[["PC1", "PC2", "PC3", "PC4"]]
        .mean()
        .reset_index()
    )
    party_sizes = scores_df.groupby(["party_code", "party_name"], dropna=False).size().reset_index(name="candidate_count")
    party_centroids = party_centroids.merge(party_sizes, on=["party_code", "party_name"], how="left")

    party_dispersion = (
        scores_df.groupby(["party_code", "party_name"], dropna=False)[["PC1", "PC2"]]
        .agg(["std"])
        .reset_index()
    )
    party_dispersion.columns = [
        "party_code",
        "party_name",
        "pc1_sd",
        "pc2_sd",
    ]
    party_centroids = party_centroids.merge(party_dispersion, on=["party_code", "party_name"], how="left")
    party_centroids["radial_distance"] = np.sqrt(party_centroids["PC1"] ** 2 + party_centroids["PC2"] ** 2)
    party_centroids["internal_dispersion"] = np.sqrt(
        party_centroids["pc1_sd"].fillna(0.0) ** 2 + party_centroids["pc2_sd"].fillna(0.0) ** 2
    )
    party_centroids = party_centroids.sort_values(["PC1", "PC2"]).reset_index(drop=True)
    party_centroids.to_csv(DATA_DIR / "party_centroids.csv", index=False)

    variance_df = pd.DataFrame(
        {
            "component": score_columns,
            "explained_variance_ratio": pca.explained_variance_ratio_,
            "explained_variance_pct": pca.explained_variance_ratio_ * 100,
            "cumulative_explained_variance_pct": np.cumsum(pca.explained_variance_ratio_) * 100,
        }
    )
    variance_df.to_csv(DATA_DIR / "explained_variance.csv", index=False)

    completeness_df = candidates_df[["candidate_id", "party_code", "party_name", "name"]].copy()
    completeness_df["answered_questions"] = answered_counts.reindex(completeness_df["candidate_id"]).fillna(0).astype(int).values
    completeness_df["is_retained_for_pca"] = completeness_df["candidate_id"].isin(retained_ids)
    completeness_df.to_csv(DATA_DIR / "candidate_answer_completeness.csv", index=False)

    return scores_df, loadings_df, party_centroids, variance_df


def render_figures(
    scores_df: pd.DataFrame,
    loadings_df: pd.DataFrame,
    party_centroids: pd.DataFrame,
    variance_df: pd.DataFrame,
) -> None:
    sns.set_theme(style="whitegrid", context="talk")

    fig, ax = plt.subplots(figsize=(14, 10))
    ax.scatter(scores_df["PC1"], scores_df["PC2"], s=10, alpha=0.15, color="#5f6b7a", edgecolors="none")
    palette = sns.color_palette("tab20", n_colors=max(len(party_centroids), 3))
    for idx, row in enumerate(party_centroids.sort_values("candidate_count", ascending=False).itertuples(index=False)):
        color = palette[idx % len(palette)]
        ax.scatter(row.PC1, row.PC2, s=120 + row.candidate_count * 1.2, color=color, edgecolors="black", linewidths=0.6)
        label = f"{row.party_code or '?'} {row.party_name} ({row.candidate_count})"
        ax.text(row.PC1, row.PC2, label, fontsize=10, ha="left", va="bottom")
    ax.axhline(0, color="black", linewidth=0.8, alpha=0.5)
    ax.axvline(0, color="black", linewidth=0.8, alpha=0.5)
    ax.set_title("FT26 candidate PCA: party centroids and candidate cloud")
    ax.set_xlabel(f"PC1 ({variance_df.iloc[0]['explained_variance_pct']:.1f}% explained variance)")
    ax.set_ylabel(f"PC2 ({variance_df.iloc[1]['explained_variance_pct']:.1f}% explained variance)")
    fig.tight_layout()
    fig.savefig(FIG_DIR / "party_centroids.png", dpi=200)
    plt.close(fig)

    top_parties = party_centroids.sort_values("candidate_count", ascending=False).head(8)["party_name"].tolist()
    top_scores = scores_df.copy()
    top_scores["party_plot"] = np.where(top_scores["party_name"].isin(top_parties), top_scores["party_name"], "Andre")
    fig, ax = plt.subplots(figsize=(14, 10))
    sns.scatterplot(
        data=top_scores,
        x="PC1",
        y="PC2",
        hue="party_plot",
        alpha=0.55,
        s=35,
        linewidth=0,
        ax=ax,
    )
    ax.axhline(0, color="black", linewidth=0.8, alpha=0.5)
    ax.axvline(0, color="black", linewidth=0.8, alpha=0.5)
    ax.set_title("FT26 candidate PCA: candidates coloured by largest parties")
    ax.set_xlabel(f"PC1 ({variance_df.iloc[0]['explained_variance_pct']:.1f}% explained variance)")
    ax.set_ylabel(f"PC2 ({variance_df.iloc[1]['explained_variance_pct']:.1f}% explained variance)")
    ax.legend(title="", frameon=True, loc="best")
    fig.tight_layout()
    fig.savefig(FIG_DIR / "candidate_scatter.png", dpi=200)
    plt.close(fig)

    def top_loading_frame(component: str) -> pd.DataFrame:
        ranked = loadings_df[["topic", "question", component]].copy()
        ranked["abs_loading"] = ranked[component].abs()
        ranked = ranked.sort_values("abs_loading", ascending=False).head(8).copy()
        ranked["label"] = (
            ranked["topic"].fillna("") + ": " + ranked["question"].fillna("")
        ).map(lambda value: textwrap.fill(value, width=42))
        ranked = ranked.sort_values(component)
        return ranked

    fig, axes = plt.subplots(1, 2, figsize=(24, 12), sharex=False)
    for ax, component in zip(axes, ["PC1", "PC2"]):
        ranked = top_loading_frame(component)
        colors = ["#9b2226" if value < 0 else "#0a9396" for value in ranked[component]]
        ax.barh(ranked["label"], ranked[component], color=colors)
        ax.set_title(f"Strongest question loadings on {component}")
        ax.set_xlabel("Loading")
        ax.tick_params(axis="y", labelsize=10)
    fig.tight_layout()
    fig.savefig(FIG_DIR / "question_loadings.png", dpi=200)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(10, 6))
    sns.barplot(data=variance_df, x="component", y="explained_variance_pct", color="#457b9d", ax=ax)
    ax.set_ylabel("Explained variance (%)")
    ax.set_xlabel("")
    ax.set_title("Explained variance by principal component")
    fig.tight_layout()
    fig.savefig(FIG_DIR / "explained_variance.png", dpi=200)
    plt.close(fig)


def format_pct(value: float) -> str:
    return f"{value:.1f}%"


def format_signed(value: float) -> str:
    return f"{value:+.2f}"


def df_to_html(df: pd.DataFrame, float_cols: list[str] | None = None) -> str:
    table = df.copy()
    if float_cols:
        for col in float_cols:
            if col in table.columns:
                table[col] = table[col].map(lambda value: f"{value:.2f}")
    table = table.fillna("")
    return table.to_html(index=False, classes="data-table", border=0, escape=True)


def party_color_map(party_centroids: pd.DataFrame) -> dict[str, str]:
    by_code = {
        "A": "#e32f3b",   # Socialdemokratiet
        "B": "#c2185b",   # Radikale Venstre
        "C": "#0b7a53",   # Konservative
        "F": "#5fb336",   # SF
        "H": "#f28c28",   # Borgernes Parti
        "I": "#41b6e6",   # Liberal Alliance
        "M": "#7f56d9",   # Moderaterne
        "O": "#d4a017",   # Dansk Folkeparti
        "V": "#1d4ed8",   # Venstre
        "Æ": "#214e9c",   # Danmarksdemokraterne
        "Ø": "#d62828",   # Enhedslisten
        "Å": "#7fbf3f",   # Alternativet
        "": "#6b7280",    # Uden for parti
    }
    fallback = "#475569"
    color_map: dict[str, str] = {}
    for row in party_centroids.itertuples(index=False):
        color_map[row.party_name] = by_code.get(row.party_code, fallback)
    return color_map


def join_items(items: list[str]) -> str:
    items = [item for item in items if item]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} og {items[1]}"
    return f"{', '.join(items[:-1])} og {items[-1]}"


def question_label(topic: str | None, question: str | None) -> str:
    clean_topic = (topic or "").strip()
    clean_question = (question or "").strip()
    if clean_topic and clean_question:
        return f"{clean_topic}: {clean_question}"
    return clean_topic or clean_question or "Ukendt spørgsmål"


def loading_rows(loadings_df: pd.DataFrame, component: str, *, positive: bool, limit: int = TOP_N_SUMMARY_ROWS) -> list[dict[str, Any]]:
    ranked = loadings_df[["topic", "question", component]].copy()
    ranked = ranked.nlargest(limit, component) if positive else ranked.nsmallest(limit, component)
    return [
        {
            "topic": row.topic,
            "question": row.question,
            "loading": getattr(row, component),
        }
        for row in ranked.itertuples(index=False)
    ]


def component_copy(
    component: str,
    variance_df: pd.DataFrame,
    loadings_df: pd.DataFrame,
    party_centroids: pd.DataFrame,
) -> tuple[str, list[dict[str, Any]], list[dict[str, Any]]]:
    negative_rows = loading_rows(loadings_df, component, positive=False)
    positive_rows = loading_rows(loadings_df, component, positive=True)
    lowest_party = party_centroids.nsmallest(1, component).iloc[0]
    highest_party = party_centroids.nlargest(1, component).iloc[0]
    variance_pct = float(
        variance_df.loc[variance_df["component"] == component, "explained_variance_pct"].iloc[0]
    )
    negative_examples = join_items([question_label(row["topic"], row["question"]) for row in negative_rows[:2]])
    positive_examples = join_items([question_label(row["topic"], row["question"]) for row in positive_rows[:2]])
    copy = (
        f"{component} forklarer {format_pct(variance_pct)} af variationen. "
        f"Den negative side er stærkest knyttet til {negative_examples}. "
        f"Den positive side er stærkest knyttet til {positive_examples}. "
        f"På partiniveau ligger {lowest_party['party_name']} lavest og {highest_party['party_name']} højest på {component}."
    )
    return copy, negative_rows, positive_rows


def build_summary(
    election: Election,
    candidates_df: pd.DataFrame,
    scores_df: pd.DataFrame,
    party_centroids: pd.DataFrame,
    answers_wide: pd.DataFrame,
    questions_df: pd.DataFrame,
    variance_df: pd.DataFrame,
    question_consistency_df: pd.DataFrame,
) -> dict[str, Any]:
    answered_counts = answers_wide.notna().sum(axis=1).reindex(candidates_df["candidate_id"]).fillna(0).astype(int)
    return {
        "election_name": election.Name,
        "run_date": date.today().isoformat(),
        "candidate_total": int(len(candidates_df)),
        "candidate_retained": int(len(scores_df)),
        "candidate_excluded": int(len(candidates_df) - len(scores_df)),
        "party_total": int(len(party_centroids)),
        "question_total": int(len(questions_df)),
        "median_answered": int(answered_counts.median()),
        "question_set_deviations": int((~question_consistency_df["same_as_common_set"]).sum()),
        "pc1_pct": float(variance_df.iloc[0]["explained_variance_pct"]),
        "pc2_pct": float(variance_df.iloc[1]["explained_variance_pct"]),
        "pc12_pct": float(variance_df.iloc[1]["cumulative_explained_variance_pct"]),
    }


def render_site(
    election: Election,
    candidates_df: pd.DataFrame,
    answers_wide: pd.DataFrame,
    scores_df: pd.DataFrame,
    loadings_df: pd.DataFrame,
    party_centroids: pd.DataFrame,
    variance_df: pd.DataFrame,
    questions_df: pd.DataFrame,
    question_consistency_df: pd.DataFrame,
    big_constituencies: list[dict[str, Any]],
    small_constituencies: list[dict[str, Any]],
    municipalities: list[dict[str, Any]],
) -> None:
    summary = build_summary(
        election,
        candidates_df,
        scores_df,
        party_centroids,
        answers_wide,
        questions_df,
        variance_df,
        question_consistency_df,
    )
    _, pc1_negative, pc1_positive = component_copy("PC1", variance_df, loadings_df, party_centroids)
    _, pc2_negative, pc2_positive = component_copy("PC2", variance_df, loadings_df, party_centroids)
    color_map = party_color_map(party_centroids)
    municipality_payload = build_municipality_payload(municipalities, big_constituencies, small_constituencies)

    interactive_candidates = (
        scores_df[
            [
                "candidate_id",
                "name",
                "party_code",
                "party_name",
                "big_constituency_name",
                "nomination_constituency",
                "small_constituency_names",
                "answered_questions",
                "PC1",
                "PC2",
                "PC3",
                "PC4",
            ]
        ]
        .copy()
        .sort_values(["party_name", "name"])
    )
    interactive_candidates["color"] = interactive_candidates["party_name"].map(color_map)
    interactive_candidates["small_constituency_names"] = interactive_candidates["small_constituency_names"].map(split_pipe_names)
    candidate_payload = interactive_candidates.to_dict(orient="records")
    ballot_candidates = (
        candidates_df[
            [
                "candidate_id",
                "name",
                "party_code",
                "party_name",
                "big_constituency_name",
                "nomination_constituency",
                "small_constituency_names",
            ]
        ]
        .copy()
        .sort_values(["party_name", "name"])
    )
    ballot_candidates["small_constituency_names"] = ballot_candidates["small_constituency_names"].map(split_pipe_names)
    ballot_candidate_payload = ballot_candidates.to_dict(orient="records")

    variance_payload = variance_df.to_dict(orient="records")
    loading_payload = {
        "pc1_negative": pc1_negative,
        "pc1_positive": pc1_positive,
        "pc2_negative": pc2_negative,
        "pc2_positive": pc2_positive,
    }

    site_payload = {
        "summary": summary,
        "municipalities": municipality_payload,
        "candidates": candidate_payload,
        "ballot_candidates": ballot_candidate_payload,
        "variance": variance_payload,
        "loadings": loading_payload,
    }

    variance_cards = "".join(
        f"""
        <article class="stat-card">
          <span class="stat-label">{row.component}</span>
          <strong class="stat-value">{row.explained_variance_pct:.1f}%</strong>
          <span class="stat-meta">Kumulativt {row.cumulative_explained_variance_pct:.1f}%</span>
        </article>
        """
        for row in variance_df.head(4).itertuples(index=False)
    )

    def loading_list(title: str, rows: list[dict[str, Any]], tone: str) -> str:
        items = "".join(
            f"""
            <li class="question-item">
              <span class="question-topic">{html.escape((row['topic'] or '').strip())}</span>
              <span class="question-text">{html.escape((row['question'] or '').strip())}</span>
              <span class="question-loading tone-{tone}">{format_signed(float(row['loading']))}</span>
            </li>
            """
            for row in rows
        )
        return f"""
        <section class="question-panel">
          <h3>{title}</h3>
          <ol class="question-list">{items}</ol>
        </section>
        """

    html_doc = f"""<!DOCTYPE html>
<html lang="da">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(election.Name)} · PCA-rapport</title>
  <link rel="stylesheet" href="styles.css">
  <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
</head>
<body>
  <div class="site-shell">
    <header class="masthead">
      <div class="masthead-grid">
        <div>
          <p class="kicker">Altinget kandidattest · PCA analyse</p>
          <h1>{html.escape(election.Name)}</h1>
          <p class="lede">
            En statisk webrapport over {html.escape(election.Prefix)}-kandidattesten bygget direkte fra Altingets frontend-API.
            Analysen reducerer {summary['question_total']} fælles spørgsmål til de vigtigste mønstre i kandidaternes svar.
          </p>
        </div>
        <dl class="meta-strip">
          <div><dt>Kørt</dt><dd>{summary['run_date']}</dd></div>
          <div><dt>Valgomat</dt><dd>{election.valgomat_id}</dd></div>
          <div><dt>Storkredse</dt><dd>{len(big_constituencies)}</dd></div>
          <div><dt>Opstillingskredse</dt><dd>{len(small_constituencies)}</dd></div>
        </dl>
      </div>
    </header>

    <nav class="section-nav">
      <a href="#overview">Overblik</a>
      <a href="#dimensions">Dimensioner</a>
      <a href="#parties">Partier</a>
      <a href="#figures">Figurer</a>
      <a href="#downloads">Filer</a>
    </nav>

    <section class="scope-toolbar" aria-labelledby="scope-heading">
      <div class="scope-card">
        <div>
          <p id="scope-heading" class="scope-label">Visning</p>
          <p class="scope-description">Vælg en kommune for at se de kandidater, der faktisk står på stemmesedlen dér, og filtrere figurerne derefter.</p>
        </div>
        <div class="scope-controls">
          <label class="scope-field" for="municipality-select">Kommune</label>
          <select id="municipality-select" class="scope-select"></select>
        </div>
        <p id="municipality-summary" class="scope-summary">Viser hele landet.</p>
      </div>
    </section>

    <main>
      <section id="overview" class="section">
        <div class="section-head">
          <h2>Overblik</h2>
          <p>Datagrundlag og hovedmål for modellen.</p>
        </div>
        <div class="stats-grid">
          <article class="stat-card"><span class="stat-label">Kandidater i alt</span><strong class="stat-value">{summary['candidate_total']}</strong><span class="stat-meta">Unikke kandidater på stemmesedlerne</span></article>
          <article class="stat-card"><span class="stat-label">Kandidater i PCA</span><strong class="stat-value">{summary['candidate_retained']}</strong><span class="stat-meta">{summary['candidate_excluded']} udeladt pga. for mange manglende svar</span></article>
          <article class="stat-card"><span class="stat-label">Partier i PCA</span><strong class="stat-value">{summary['party_total']}</strong><span class="stat-meta">Partier med mindst én kandidat i PCA-resultatet</span></article>
          <article class="stat-card"><span class="stat-label">Fælles spørgsmål</span><strong class="stat-value">{summary['question_total']}</strong><span class="stat-meta">Median svarprocent: {summary['median_answered']}/{summary['question_total']}</span></article>
        </div>

        <div class="two-col">
          <article class="note-panel">
            <h3>Metode i korte træk</h3>
            <ul class="plain-list">
              <li>Svarskalaen 1, 2, 4 og 5 er omsat til en symmetrisk numerisk skala fra -2 til +2.</li>
              <li>Kun de {summary['question_total']} spørgsmål, som går igen i alle storkredse, er taget med.</li>
              <li>Kandidater med færre end {MIN_ANSWERED_QUESTIONS} besvarelser er udeladt af PCA-modellen.</li>
              <li>Resten er standardiseret spørgsmål for spørgsmål, så ingen enkeltsager dominerer alene på skala.</li>
            </ul>
          </article>
          <article class="note-panel">
            <h3>Datakvalitet</h3>
            <ul class="plain-list">
              <li>Spørgsmålsgrundlaget er ens på tværs af alle storkredse: {summary['question_set_deviations']} afvigelser fundet.</li>
              <li>Kandidatmetadata, stemmesedler og besvarelser er hentet fra samme API som den offentlige kandidattest bruger.</li>
              <li>Alle råfiler og mellemresultater ligger ved siden af websiden, så analysen kan revideres.</li>
            </ul>
          </article>
        </div>
      </section>

      <section id="dimensions" class="section">
        <div class="section-head">
          <h2>De to vigtigste dimensioner</h2>
          <p>PC1 og PC2 forklarer tilsammen {summary['pc12_pct']:.1f}% af variationen. Fortolkningen nedenfor er genereret direkte fra de stærkeste loadings og partiernes centroidplaceringer.</p>
        </div>

        <div class="variance-grid">
          {variance_cards}
        </div>

        <div class="dimension-grid">
          <article class="dimension-card">
            <div class="dimension-topline">
              <span>PC1</span>
              <strong>{summary['pc1_pct']:.1f}% af variationen</strong>
            </div>
            <div class="question-columns">
              {loading_list("Negativ side", pc1_negative, "negative")}
              {loading_list("Positiv side", pc1_positive, "positive")}
            </div>
          </article>

          <article class="dimension-card">
            <div class="dimension-topline">
              <span>PC2</span>
              <strong>{summary['pc2_pct']:.1f}% af variationen</strong>
            </div>
            <div class="question-columns">
              {loading_list("Negativ side", pc2_negative, "negative")}
              {loading_list("Positiv side", pc2_positive, "positive")}
            </div>
          </article>
        </div>
      </section>

      <section id="parties" class="section">
        <div class="section-head">
          <h2>Partiernes placeringer</h2>
          <p id="party-section-copy">Tabellerne viser partiernes gennemsnitlige placering i PCA-rummet og hvilke partier der spænder mest internt blandt kandidaterne i den valgte kommune.</p>
        </div>

        <div class="table-grid">
          <article class="table-card">
            <h3>Mest negative på PC1</h3>
            <div id="table-pc1-neg"></div>
          </article>
          <article class="table-card">
            <h3>Mest positive på PC1</h3>
            <div id="table-pc1-pos"></div>
          </article>
          <article class="table-card">
            <h3>Mest negative på PC2</h3>
            <div id="table-pc2-neg"></div>
          </article>
          <article class="table-card">
            <h3>Mest positive på PC2</h3>
            <div id="table-pc2-pos"></div>
          </article>
        </div>

        <article class="table-card full-width-card">
          <h3>Partier med størst intern spredning</h3>
          <p class="table-note">Spredningen er beregnet som kombineret standardafvigelse i PC1/PC2-planet.</p>
          <div id="table-dispersion"></div>
        </article>

        <article class="table-card full-width-card">
          <h3>Kandidater på stemmesedlen</h3>
          <p class="table-note">Vælg en kommune for at se de kandidater, du faktisk kan stemme på dér.</p>
          <div id="table-candidates"></div>
        </article>
      </section>

      <section id="figures" class="section">
        <div class="section-head">
          <h2>Figurer</h2>
          <p id="figure-section-copy">De vigtigste PCA-figurer er gjort interaktive. Filtrér partier, vælg kommune, og hold musen over en kandidat for at se navn, parti og placering.</p>
        </div>

        <section class="interactive-block">
          <div class="interactive-head">
            <div>
              <h3>Kandidater i PC1/PC2-rummet</h3>
              <p>Farvet efter parti. Brug filtrene til at skjule eller fremhæve partier.</p>
            </div>
            <div class="filter-actions">
              <button type="button" class="filter-button" data-filter-action="all">Vis alle</button>
              <button type="button" class="filter-button" data-filter-action="none">Skjul alle</button>
            </div>
          </div>
          <div id="party-filter" class="party-filter" aria-label="Partifilter"></div>
          <div id="candidate-chart" class="plot-frame"></div>
        </section>

        <section class="interactive-block">
          <div class="interactive-head">
            <div>
              <h3>Particentroider</h3>
              <p>Hvert punkt er et partis gennemsnitsplacering. Krydsene viser spredningen i partiets kandidater på PC1 og PC2.</p>
            </div>
          </div>
          <div id="centroid-chart" class="plot-frame plot-frame-short"></div>
        </section>

        <div class="figure-stack">
          <figure class="figure-card">
            <img src="../figures/question_loadings.png" alt="Question loading plot">
            <figcaption>De spørgsmål, der driver PC1 og PC2 mest i hver retning.</figcaption>
          </figure>
          <figure class="figure-card narrow-figure">
            <img src="../figures/explained_variance.png" alt="Explained variance plot">
            <figcaption>Hvor meget variation de første fire komponenter forklarer.</figcaption>
          </figure>
        </div>
      </section>

      <section id="downloads" class="section">
        <div class="section-head">
          <h2>Filer</h2>
          <p>Rådata, mellemresultater og figurer ligger alle lokalt sammen med websiden.</p>
        </div>
        <div class="download-grid">
          <a class="download-card" href="../data/candidates.csv">Kandidatmetadata</a>
          <a class="download-card" href="../data/answers_wide.csv">Svarmatrix</a>
          <a class="download-card" href="../data/candidate_pca_scores.csv">Kandidat-scorer</a>
          <a class="download-card" href="../data/question_loadings.csv">Question loadings</a>
          <a class="download-card" href="../data/party_centroids.csv">Particentroider</a>
        </div>
      </section>
    </main>
  </div>
  <script src="site-data.js"></script>
  <script src="app.js"></script>
</body>
</html>
"""

    css = """
:root {
  --bg: #f5f5f4;
  --paper: #fbfaf7;
  --line: #d9d3ca;
  --ink: #201b17;
  --muted: #6f655d;
  --accent: #0f766e;
  --accent-soft: #d9eeea;
  --warm: #9f2a2a;
  --warm-soft: #f3dfdf;
  --shadow: rgba(24, 20, 16, 0.08);
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  background:
    linear-gradient(to bottom, rgba(255,255,255,0.45), rgba(255,255,255,0.45)),
    repeating-linear-gradient(180deg, transparent 0, transparent 27px, rgba(32, 27, 23, 0.035) 28px);
  background-color: var(--bg);
  color: var(--ink);
  font-family: "Avenir Next", "Segoe UI", sans-serif;
  line-height: 1.55;
}

.site-shell {
  width: min(1220px, calc(100vw - 32px));
  margin: 0 auto 64px;
}

.masthead {
  padding: 40px 0 28px;
  border-bottom: 1px solid var(--line);
}

.masthead-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.8fr) minmax(260px, 0.9fr);
  gap: 28px;
  align-items: end;
}

.kicker {
  margin: 0 0 12px;
  color: var(--muted);
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1,
h2,
h3 {
  font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0;
}

h1 {
  font-size: clamp(2.6rem, 7vw, 5.2rem);
  line-height: 0.95;
  max-width: 9ch;
}

.lede {
  max-width: 62ch;
  margin: 18px 0 0;
  font-size: 1.05rem;
  color: var(--muted);
}

.meta-strip {
  margin: 0;
  padding: 18px 18px 14px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 18px;
  border: 1px solid var(--line);
  background: rgba(251, 250, 247, 0.82);
}

.meta-strip dt {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.meta-strip dd {
  margin: 0;
  font-size: 1rem;
}

.section-nav {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  gap: 18px;
  padding: 12px 0;
  background: rgba(245, 245, 244, 0.92);
  backdrop-filter: blur(6px);
  border-bottom: 1px solid var(--line);
}

.section-nav a {
  color: var(--ink);
  text-decoration: none;
  font-size: 0.96rem;
}

.section-nav a:hover {
  color: var(--accent);
}

.scope-toolbar {
  padding-top: 22px;
}

.scope-card {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(240px, 0.7fr);
  gap: 18px 24px;
  align-items: end;
  padding: 18px;
  border: 1px solid var(--line);
  background: rgba(251, 250, 247, 0.9);
}

.scope-label {
  margin: 0 0 6px;
  color: var(--muted);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.scope-description,
.scope-summary {
  margin: 0;
  color: var(--muted);
}

.scope-controls {
  justify-self: end;
  width: min(100%, 280px);
}

.scope-field {
  display: block;
  margin-bottom: 8px;
  color: var(--muted);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.scope-select {
  width: 100%;
  appearance: none;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink);
  padding: 12px 14px;
  font: inherit;
}

.scope-summary {
  grid-column: 1 / -1;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}

.section {
  padding: 36px 0 0;
}

.section-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
  gap: 16px;
  align-items: end;
  margin-bottom: 20px;
}

.section-head h2 {
  font-size: clamp(1.7rem, 4vw, 2.6rem);
}

.section-head p {
  margin: 0;
  color: var(--muted);
  max-width: 62ch;
}

.stats-grid,
.variance-grid,
.table-grid,
.download-grid {
  display: grid;
  gap: 14px;
}

.stats-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.variance-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-bottom: 14px;
}

.stat-card,
.note-panel,
.dimension-card,
.table-card,
.figure-card,
.download-card {
  border: 1px solid var(--line);
  background: rgba(251, 250, 247, 0.88);
}

.stat-card {
  padding: 18px;
  min-height: 132px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.stat-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
}

.stat-value {
  font-size: clamp(1.7rem, 4vw, 2.6rem);
  font-weight: 600;
}

.stat-meta {
  color: var(--muted);
  font-size: 0.94rem;
}

.two-col,
.dimension-grid,
.question-columns {
  display: grid;
  gap: 14px;
}

.two-col {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 14px;
}

.dimension-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.note-panel,
.dimension-card,
.table-card {
  padding: 18px;
}

.plain-list {
  margin: 14px 0 0;
  padding-left: 18px;
}

.plain-list li + li {
  margin-top: 10px;
}

.dimension-topline {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: baseline;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}

.dimension-topline span {
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 12px;
}

.dimension-topline strong {
  font-size: 1.1rem;
}

.dimension-copy {
  margin: 14px 0 0;
  color: var(--muted);
}

.question-columns {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 18px;
}

.question-panel h3 {
  font-size: 1.05rem;
  margin-bottom: 10px;
}

.question-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.question-item {
  padding: 12px 0;
  border-top: 1px solid var(--line);
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px 12px;
}

.question-item:first-child {
  border-top: 0;
  padding-top: 0;
}

.question-topic {
  grid-column: 1 / 2;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.question-text {
  grid-column: 1 / 2;
  font-size: 0.95rem;
}

.question-loading {
  grid-column: 2 / 3;
  grid-row: 1 / span 2;
  align-self: center;
  font-weight: 700;
}

.tone-negative {
  color: var(--warm);
}

.tone-positive {
  color: var(--accent);
}

.table-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.full-width-card {
  margin-top: 14px;
}

.table-card h3 {
  margin-bottom: 12px;
  font-size: 1.15rem;
}

.table-note {
  margin: 0 0 12px;
  color: var(--muted);
  font-size: 0.94rem;
}

.table-empty {
  margin: 0;
  color: var(--muted);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.92rem;
}

.data-table th,
.data-table td {
  text-align: left;
  padding: 9px 10px;
  border-top: 1px solid var(--line);
  vertical-align: top;
}

.data-table thead th {
  border-top: 0;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.data-table tbody tr:hover {
  background: rgba(15, 118, 110, 0.04);
}

.figure-stack {
  display: grid;
  gap: 18px;
}

.interactive-block {
  border: 1px solid var(--line);
  background: rgba(251, 250, 247, 0.88);
  padding: 18px;
  margin-bottom: 18px;
}

.interactive-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 14px;
}

.interactive-head h3 {
  font-size: 1.15rem;
  margin-bottom: 4px;
}

.interactive-head p {
  margin: 0;
  color: var(--muted);
  max-width: 60ch;
}

.filter-actions {
  display: flex;
  gap: 8px;
}

.filter-button {
  appearance: none;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink);
  padding: 8px 12px;
  cursor: pointer;
  font: inherit;
}

.filter-button:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.party-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.party-toggle {
  appearance: none;
  border: 1px solid var(--line);
  background: white;
  color: var(--ink);
  padding: 8px 12px;
  cursor: pointer;
  font: inherit;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.party-toggle.is-active {
  border-color: var(--ink);
  background: rgba(32, 27, 23, 0.05);
}

.party-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  display: inline-block;
}

.plot-frame {
  width: 100%;
  min-height: 640px;
  border: 1px solid var(--line);
  background: white;
}

.plot-frame-short {
  min-height: 460px;
}

.figure-card {
  padding: 18px;
}

.figure-card img {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--line);
  background: white;
}

.figure-card figcaption {
  margin-top: 10px;
  color: var(--muted);
  font-size: 0.94rem;
}

.narrow-figure {
  max-width: 820px;
}

.download-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.download-card {
  display: block;
  padding: 16px 18px;
  color: var(--ink);
  text-decoration: none;
  font-weight: 600;
}

.download-card:hover {
  color: var(--accent);
  border-color: var(--accent);
}

@media (max-width: 980px) {
  .masthead-grid,
  .scope-card,
  .section-head,
  .stats-grid,
  .variance-grid,
  .two-col,
  .dimension-grid,
  .question-columns,
  .table-grid,
  .download-grid {
    grid-template-columns: 1fr;
  }

  .section-nav {
    overflow-x: auto;
    white-space: nowrap;
  }

  .interactive-head {
    flex-direction: column;
  }

  .scope-controls {
    justify-self: stretch;
    width: 100%;
  }
}

@media (max-width: 640px) {
  .site-shell {
    width: min(100vw - 20px, 1220px);
  }

  .masthead {
    padding-top: 24px;
  }

  .stat-card,
  .note-panel,
  .dimension-card,
  .table-card,
  .figure-card,
  .download-card {
    padding: 14px;
  }

  .data-table {
    font-size: 0.86rem;
  }

  .plot-frame {
    min-height: 480px;
  }
}
"""

    (SITE_DIR / "index.html").write_text(html_doc, encoding="utf-8")
    (SITE_DIR / "styles.css").write_text(css.strip() + "\n", encoding="utf-8")
    (SITE_DIR / "site-data.json").write_text(json.dumps(site_payload, ensure_ascii=False), encoding="utf-8")
    (SITE_DIR / "site-data.js").write_text(
        "window.__SITE_DATA__ = " + json.dumps(site_payload, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    (SITE_DIR / "app.js").write_text(
        """
const candidateChartEl = document.getElementById("candidate-chart");
const centroidChartEl = document.getElementById("centroid-chart");
const filterEl = document.getElementById("party-filter");
const municipalitySelectEl = document.getElementById("municipality-select");
const municipalitySummaryEl = document.getElementById("municipality-summary");
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
  const label = scopes.length === 1 ? "opstillingskreds" : "opstillingskredse";
  return `${scopes.length} ${label}`;
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
      const pc1Sd = sampleStd(pc1Values);
      const pc2Sd = sampleStd(pc2Values);
      return {
        party_name: partyName,
        party_code: firstRow.party_code || "",
        candidate_count: partyRows.length,
        PC1: mean(pc1Values),
        PC2: mean(pc2Values),
        PC3: mean(partyRows.map((row) => row.PC3)),
        PC4: mean(partyRows.map((row) => row.PC4)),
        pc1_sd: pc1Sd,
        pc2_sd: pc2Sd,
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
      renderCandidateChart();
      renderCentroidChart();
    });
    filterEl.appendChild(button);
  }
}

function candidateTrace(partyName, rows) {
  const municipality = selectedMunicipalityRecord();
  return {
    type: "scattergl",
    mode: "markers",
    name: partyName,
    x: rows.map((row) => row.PC1),
    y: rows.map((row) => row.PC2),
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
      row.big_constituency_name || "",
      row.nomination_constituency || "",
      formatBallotScopeForHover(row, municipality),
      row.answered_questions,
      row.PC3,
      row.PC4
    ]),
    hovertemplate:
      "<b>%{customdata[0]}</b><br>" +
      "%{customdata[2]} · %{customdata[1]}<br>" +
      "Storkreds: %{customdata[3]}<br>" +
      "Nominationskreds: %{customdata[4]}<br>" +
      "Stiller op i: %{customdata[5]}<br>" +
      "PC1: %{x:.2f}<br>" +
      "PC2: %{y:.2f}<br>" +
      "PC3: %{customdata[7]:.2f}<br>" +
      "PC4: %{customdata[8]:.2f}<br>" +
      "Besvarede spørgsmål: %{customdata[6]}<extra></extra>"
  };
}

function centroidTrace(rows) {
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
    "Æ": "top right",
    "Ø": "top left",
    "Å": "top center",
    "": "top center"
  };
  return {
    type: "scatter",
    mode: "markers+text",
    x: rows.map((row) => row.PC1),
    y: rows.map((row) => row.PC2),
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
      array: rows.map((row) => row.pc1_sd || 0),
      visible: true,
      thickness: 1.4,
      width: 0,
      color: "rgba(32,27,23,0.4)"
    },
    error_y: {
      type: "data",
      array: rows.map((row) => row.pc2_sd || 0),
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
      row.pc1_sd || 0,
      row.pc2_sd || 0
    ]),
    hovertemplate:
      "<b>%{customdata[1]} · %{customdata[0]}</b><br>" +
      "PC1: %{x:.2f}<br>" +
      "PC2: %{y:.2f}<br>" +
      "Spredning PC1: %{customdata[4]:.2f}<br>" +
      "Spredning PC2: %{customdata[5]:.2f}<br>" +
      "Kandidater i PCA: %{customdata[2]}<br>" +
      "Intern spredning: %{customdata[3]:.2f}<extra></extra>"
  };
}

function baseLayout(title, xTitle, yTitle) {
  return {
    title: { text: title, x: 0.02, xanchor: "left", font: { family: "Iowan Old Style, Georgia, serif", size: 22, color: "#201b17" } },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    margin: { l: 58, r: 24, t: 56, b: 56 },
    xaxis: {
      title: xTitle,
      range: axisRanges ? axisRanges.x : undefined,
      zeroline: true,
      zerolinecolor: "rgba(32,27,23,0.25)",
      gridcolor: "rgba(32,27,23,0.09)",
      autorange: false
    },
    yaxis: {
      title: yTitle,
      range: axisRanges ? axisRanges.y : undefined,
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

function computeAxisRanges() {
  const xs = siteData.candidates.map((row) => row.PC1);
  const ys = siteData.candidates.map((row) => row.PC2);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xPad = Math.max((xMax - xMin) * 0.08, 0.5);
  const yPad = Math.max((yMax - yMin) * 0.08, 0.5);
  axisRanges = {
    x: [xMin - xPad, xMax + xPad],
    y: [yMin - yPad, yMax + yPad]
  };
}

function emptyStateLayout(title, message) {
  const layout = baseLayout(titleWithMunicipality(title), `PC1 (${siteData.summary.pc1_pct.toFixed(1)}%)`, `PC2 (${siteData.summary.pc2_pct.toFixed(1)}%)`);
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
    figureSectionCopyEl.textContent = "De vigtigste PCA-figurer er gjort interaktive. Filtrér partier, vælg kommune, og hold musen over en kandidat for at se navn, parti og placering.";
    return;
  }
  const municipality = selectedMunicipalityRecord();
  const scopeCount = municipality ? municipality.small_constituencies.length : 0;
  const constituencyLabel = scopeCount === 1 ? "opstillingskreds" : "opstillingskredse";
  partySectionCopyEl.textContent = `Tabellerne viser partiernes gennemsnitlige placering og interne spænd blandt kandidater, der står på stemmesedlen i ${selectedMunicipality}.`;
  figureSectionCopyEl.textContent = `De interaktive figurer viser kun kandidater, der står på stemmesedlen i ${selectedMunicipality} på tværs af ${scopeCount} ${constituencyLabel}.`;
}

function updateMunicipalitySummary(rows, centroids) {
  if (selectedMunicipality === ALL_MUNICIPALITIES) {
    municipalitySummaryEl.textContent = `Viser hele landet: ${rows.length} kandidater i PCA fordelt på ${centroids.length} partier.`;
    return;
  }
  const municipality = selectedMunicipalityRecord();
  const bigConstituency = municipality?.big_constituency_name || "ukendt storkreds";
  const scopeCount = municipality ? municipality.small_constituencies.length : 0;
  const constituencyLabel = scopeCount === 1 ? "opstillingskreds" : "opstillingskredse";
  municipalitySummaryEl.textContent = `Viser ${selectedMunicipality}: ${rows.length} kandidater i PCA fordelt på ${centroids.length} partier. Kommunevalglisten ligger i ${bigConstituency} og dækker ${scopeCount} ${constituencyLabel}.`;
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
      "Vælg en kommune for at se de kandidater, der faktisk står på stemmesedlen dér."
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
      { key: "municipality_scope", label: "På stemmesedlen i", format: (value) => value || "Hele kommunen" }
    ],
    rows,
    "Ingen kandidater fundet for den valgte kommune."
  );
}

function renderCandidateChart() {
  const grouped = groupBy(visibleCandidateRows(), "party_name");
  const traces = Array.from(grouped.entries())
    .sort((a, b) => a[0].localeCompare(b[0], "da"))
    .map(([partyName, rows]) => candidateTrace(partyName, rows));
  const layout = traces.length
    ? baseLayout(
        titleWithMunicipality("Kandidater farvet efter parti"),
        `PC1 (${siteData.summary.pc1_pct.toFixed(1)}% forklaret variation)`,
        `PC2 (${siteData.summary.pc2_pct.toFixed(1)}% forklaret variation)`
      )
    : emptyStateLayout("Kandidater farvet efter parti", "Vælg mindst ét parti for at vise kandidaterne i den valgte kommune.");

  Plotly.react(
    candidateChartEl,
    traces,
    layout,
    { responsive: true, displayModeBar: false }
  );
}

function renderCentroidChart() {
  const rows = buildCentroids(visibleCandidateRows());
  const traces = rows.length ? [centroidTrace(rows)] : [];
  const layout = traces.length
    ? baseLayout(
        titleWithMunicipality("Partiernes gennemsnitlige placering"),
        `PC1 (${siteData.summary.pc1_pct.toFixed(1)}%)`,
        `PC2 (${siteData.summary.pc2_pct.toFixed(1)}%)`
      )
    : emptyStateLayout("Partiernes gennemsnitlige placering", "Vælg mindst ét parti for at vise particentroiderne i den valgte kommune.");
  Plotly.react(
    centroidChartEl,
    traces,
    layout,
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
  renderCandidateChart();
  renderCentroidChart();
}

function boot() {
  siteData = window.__SITE_DATA__;
  if (!siteData) {
    throw new Error("Missing embedded site data.");
  }

  computeAxisRanges();
  buildMunicipalityOptions(siteData.municipalities.slice().sort((a, b) => a.name.localeCompare(b.name, "da")));
  syncPartyControls(true);

  municipalitySelectEl.addEventListener("change", () => {
    selectedMunicipality = municipalitySelectEl.value;
    syncPartyControls(true);
    renderAll();
  });

  document.querySelector('[data-filter-action="all"]').addEventListener("click", () => {
    activeParties = new Set(buildCentroids(municipalityRows()).map((party) => party.party_name));
    document.querySelectorAll(".party-toggle").forEach((el) => el.classList.add("is-active"));
    renderCandidateChart();
    renderCentroidChart();
  });

  document.querySelector('[data-filter-action="none"]').addEventListener("click", () => {
    activeParties = new Set();
    document.querySelectorAll(".party-toggle").forEach((el) => el.classList.remove("is-active"));
    renderCandidateChart();
    renderCentroidChart();
  });

  renderAll();
}

boot();
        """.strip()
        + "\n",
        encoding="utf-8",
    )
def main() -> None:
    ensure_dirs()
    session = make_session()
    election, big_constituencies, small_constituencies, municipalities = fetch_election_metadata(session)

    (RAW_DIR / "big_constituencies.json").write_text(json.dumps(big_constituencies, ensure_ascii=False, indent=2), encoding="utf-8")
    (RAW_DIR / "small_constituencies.json").write_text(json.dumps(small_constituencies, ensure_ascii=False, indent=2), encoding="utf-8")
    (RAW_DIR / "municipalities.json").write_text(json.dumps(municipalities, ensure_ascii=False, indent=2), encoding="utf-8")

    questions_df, question_consistency_df = prepare_questions(session, big_constituencies)
    candidates_df, candidate_big_group = prepare_candidates(session, small_constituencies)
    answers_wide = prepare_answers(
        session,
        candidates_df,
        candidate_big_group,
        questions_df["question_id"].tolist(),
    )

    scores_df, loadings_df, party_centroids, variance_df = run_pca(candidates_df, answers_wide, questions_df)
    render_figures(scores_df, loadings_df, party_centroids, variance_df)
    render_site(
        election,
        candidates_df,
        answers_wide,
        scores_df,
        loadings_df,
        party_centroids,
        variance_df,
        questions_df,
        question_consistency_df,
        big_constituencies,
        small_constituencies,
        municipalities,
    )


if __name__ == "__main__":
    main()
