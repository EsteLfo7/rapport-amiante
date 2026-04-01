import os
import json
import yaml
from pathlib import Path
from google import genai
from google.genai import types


from ..env.var import RapportAmiante
from ..env.prompt import build_prompt


default_path = Path("config/prestataires/default.yaml")


def extract_rapport(pdf_path: str, prestataire: str = "default", model="gemini-2.5-flash") -> RapportAmiante:



    with open(default_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)
    prompt = build_prompt(config)


    with open(pdf_path, "rb") as f:
        pdf_bytes = f.read()




    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))


    response = client.models.generate_content(
        model=model,
        contents=[
            types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
            prompt
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=RapportAmiante
        )
    )

    data = json.loads(response.text)



    return RapportAmiante(**data)
