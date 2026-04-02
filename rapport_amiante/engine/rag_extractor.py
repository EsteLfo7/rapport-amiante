"""RAG extractor: extrait le texte brut d'un PDF via pdfplumber,
le découpe en chunks et récupère les passages les plus pertinents
pour chaque groupe de colonnes défini dans variables/var.py.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

from ..variables.var import COLUMNS_FR, VALEURS_DIAGNOSTIC

# ---------------------------------------------------------------------------
# Groupes thématiques de champs — alignés sur RapportAmiante / COLUMNS_FR
# ---------------------------------------------------------------------------
CHUNK_SIZE = 800   # caractères par chunk
CHUNK_OVERLAP = 150

COLUMN_GROUPS: dict[str, list[str]] = {
    "en_tete": [
        "reference_rapport", "date_rapport", "operateur_reperage",
        "prestataire", "adresse", "batiment", "etage", "porte",
        "reserves", "materiaux_amiantes", "localisation", "nombre_prelevements",
    ],
    "cuisine": [
        "cuisine_sol", "cuisine_murs", "cuisine_plafond",
        "cuisine_faience", "cuisine_evier",
    ],
    "salle_deau": [
        "sdb_sol", "sdb_murs", "sdb_plafonds", "sdb_faience",
    ],
    "wc": [
        "wc_sol", "wc_murs", "wc_plafond",
    ],
    "autres": [
        "loggia_balcon", "celliers", "autre",
    ],
    "commentaires": [
        "commentaire_1", "commentaire_2", "commentaire_3",
    ],
}

# Mots-clés de recherche par groupe (termes présents dans les rapports réels)
GROUP_KEYWORDS: dict[str, list[str]] = {
    "en_tete": [
        "référence", "reference", "date", "opérateur", "operateur",
        "prestataire", "adresse", "bâtiment", "batiment", "étage", "etage",
        "porte", "logement", "réserve", "reserve", "matériau", "materiau",
        "localisation", "prélèvement", "prelevement",
    ],
    "cuisine": ["cuisine", "sol", "mur", "plafond", "faïence", "faience", "évier", "evier"],
    "salle_deau": ["salle d'eau", "sdb", "salle de bain", "sol", "mur", "plafond", "faïence"],
    "wc": ["wc", "toilette", "sol", "mur", "plafond"],
    "autres": ["loggia", "balcon", "cellier", "cave", "autre"],
    "commentaires": ["commentaire", "observation", "remarque", "note"],
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_text(pdf_path: str) -> str:
    """Extrait tout le texte d'un PDF via pdfplumber (conserve la mise en page)."""
    try:
        import pdfplumber
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "Dépendance Python manquante: pdfplumber. Installe les dépendances backend."
        ) from exc

    pages: list[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text(x_tolerance=3, y_tolerance=3)
            if text:
                pages.append(text)
    return "\n".join(pages)


def _chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Découpe le texte en chunks avec chevauchement."""
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        chunks.append(text[start:end])
        start += size - overlap
    return chunks


def _score_chunk(chunk: str, keywords: list[str]) -> int:
    """Compte combien de mots-clés apparaissent dans le chunk (insensible à la casse)."""
    lower = chunk.lower()
    return sum(1 for kw in keywords if kw.lower() in lower)


def _retrieve_chunks(chunks: list[str], keywords: list[str], top_k: int = 3) -> str:
    """Retourne les top_k chunks les plus pertinents pour un groupe de colonnes."""
    scored = sorted(
        enumerate(chunks),
        key=lambda x: _score_chunk(x[1], keywords),
        reverse=True,
    )
    best_indices = sorted(idx for idx, _ in scored[:top_k])
    return "\n...(suite)...\n".join(chunks[i] for i in best_indices)


# ---------------------------------------------------------------------------
# Interface publique
# ---------------------------------------------------------------------------

def extract_text_from_pdf(pdf_path: str) -> str:
    """Point d'entrée : retourne le texte brut complet du PDF."""
    return _extract_text(pdf_path)


def retrieve_context_by_group(full_text: str) -> dict[str, str]:
    """
    Pour chaque groupe de colonnes, retourne un contexte textuel ciblé
    extrait du texte complet du PDF.

    Returns
    -------
    dict[str, str]
        Clé = nom du groupe, valeur = texte contextualisé (chunks concatenés).
    """
    chunks = _chunk_text(full_text)
    return {
        group: _retrieve_chunks(chunks, keywords)
        for group, keywords in GROUP_KEYWORDS.items()
    }


def build_rag_context(pdf_path: str) -> dict[str, str]:
    """
    Pipeline complet RAG pour un PDF :
    1. Extraction du texte brut
    2. Découpage en chunks
    3. Récupération des passages pertinents par groupe de colonnes

    Returns
    -------
    dict avec clés : "full_text" + un contexte par groupe (en_tete, cuisine, …)
    """
    full_text = _extract_text(pdf_path)
    context_by_group = retrieve_context_by_group(full_text)
    return {"full_text": full_text, **context_by_group}
