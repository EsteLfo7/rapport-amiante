"""Post-traitement LLM léger (RAG mode).

Prend les contextes textuels extraits par rag_extractor.py
et appelle un modèle Gemini Flash Lite pour structurer les informations
en un objet RapportAmiante valide.

Le prompt utilisé réutilise les contraintes définies dans variables/prompt.py
afin de garder une cohérence stricte des valeurs de colonnes.
"""
from __future__ import annotations

import json
import os

from google import genai
from google.genai import types

from ..variables.var import RapportAmiante, VALEURS_DIAGNOSTIC
from ..variables.prompt import build_prompt

# Modèle léger pour le post-traitement RAG
RAG_POSTPROCESS_MODEL = "gemini-2.5-flash-lite"

# Prompt système de post-traitement : focalise le LLM sur la structuration
_POSTPROCESS_SYSTEM = """
Tu reçois des extraits de texte issus d'un rapport de diagnostic amiante.
Ton rôle est UNIQUEMENT de remplir les champs demandés à partir de ces extraits.
Ne reformule pas, ne déduis pas ce qui n'est pas présent dans le texte.
Si l'information est absente ou ambigüe → null.
Réponds en JSON valide uniquement, sans texte supplémentaire.
"""


def _build_postprocess_prompt(context_by_group: dict[str, str]) -> str:
    """
    Construit le prompt combiné pour le post-traitement :
    - Instructions générales (issues de build_prompt)
    - Contextes textuels par groupe de colonnes
    """
    base_instructions = build_prompt({})

    sections: list[str] = [base_instructions, "\n--- EXTRAITS DU DOCUMENT ---\n"]

    group_labels = {
        "en_tete": "Informations générales",
        "cuisine": "Cuisine",
        "salle_deau": "Salle d'eau",
        "wc": "WC / Toilettes",
        "autres": "Autres pièces (loggia, celliers, autre)",
        "commentaires": "Commentaires",
    }

    for group, label in group_labels.items():
        context = context_by_group.get(group, "")
        if context.strip():
            sections.append(f"### {label}\n{context}\n")

    sections.append(
        "\n--- INSTRUCTION FINALE ---\n"
        "Remplis maintenant les champs JSON en respectant strictement "
        "la légende (A/N/R/?/null) pour les diagnostics par pièce."
    )

    return "\n".join(sections)


def postprocess_rag(
    context_by_group: dict[str, str],
    model: str = RAG_POSTPROCESS_MODEL,
) -> RapportAmiante:
    """
    Post-traitement LLM léger : à partir des contextes extraits par groupe,
    appelle Gemini pour produire un objet RapportAmiante structuré.

    Parameters
    ----------
    context_by_group:
        Dictionnaire {groupe: texte_contexte} produit par build_rag_context().
    model:
        Nom du modèle Gemini à utiliser (défaut : gemini-2.0-flash-lite).

    Returns
    -------
    RapportAmiante
        Objet Pydantic rempli avec les données extraites.
    """
    prompt = _build_postprocess_prompt(context_by_group)

    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

    response = client.models.generate_content(
        model=model,
        contents=[
            types.Part.from_text(text=_POSTPROCESS_SYSTEM),
            types.Part.from_text(text=prompt),
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=RapportAmiante,
        ),
    )

    data = json.loads(response.text)
    return RapportAmiante(**data)
