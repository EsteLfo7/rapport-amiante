from __future__ import annotations

import json
import logging
import os
import time
from functools import lru_cache
from typing import Any

from google import genai
from google.genai import types

from ..variables.var import API_RETRY_DELAYS_SECONDS


@lru_cache(maxsize=1)
def get_gemini_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        raise RuntimeError(
            "La variable d'environnement GEMINI_API_KEY est absente. "
            "Ajoute-la dans ton environnement ou dans ton fichier .env."
        )

    return genai.Client(api_key=api_key)


def generate_structured_output(
    *,
    model: str,
    contents: list[Any],
    response_schema: type,
    logger: logging.Logger | None = None,
) -> dict[str, str | None]:
    client = get_gemini_client()
    retry_delays = (0.0, *API_RETRY_DELAYS_SECONDS)
    last_error: Exception | None = None

    for attempt_index, retry_delay in enumerate(retry_delays, start=1):
        if retry_delay:
            time.sleep(retry_delay)

        try:
            response = client.models.generate_content(
                model=model,
                contents=contents,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=response_schema,
                    temperature=0,
                ),
            )

            payload = json.loads(response.text)
            validated_response = response_schema.model_validate(payload)
            return validated_response.model_dump()

        except Exception as error:
            last_error = error

            if logger is not None:
                logger.warning(
                    "Echec appel Gemini | tentative=%s | modele=%s | erreur=%s",
                    attempt_index,
                    model,
                    error,
                )

    raise RuntimeError(f"Echec de l'appel Gemini après plusieurs tentatives: {last_error}")
