from pydantic import BaseModel
from typing import Optional


MODEL = "gemini-2.5-pro"


COLUMNS_FR = {
    "reference_rapport":           "Référence du rapport",
    "date_rapport":                "Date du rapport",
    "operateur_reperage":          "Opérateur de repérage",
    "prestataire":                 "Prestataire",
    "adresse":                     "Adresse",
    "batiment":                    "Bâtiment",
    "etage":                       "Etage",
    "porte":                       "Porte / Logement",
    "localisation_lot":            "Localisation / Lot",
    "reserves":                    "Réserves",
    "conclusion_presence_amiante": "Conclusion - Présence d'amiante",
    "sdb_colle_faience":           "Salle d'eau Colle de faïence",
    "sdb_enduits_murs":            "Salle d'eau enduits murs",
    "sdb_enduits_plafonds":        "Salle d'eau enduits plafonds",
    "sdb_revetement_sol":          "Salle d'eau revêtement de sol",
    "wc_enduits_murs":             "WC enduits murs",
    "wc_enduits_plafond":          "WC enduits plafond",
    "wc_revetement_sol":           "WC revêtement de sol",
    "cuisine_faience":             "Cuisine Faïence",
    "cuisine_enduits_murs":        "Cuisine enduits murs",
    "cuisine_enduits_plafonds":    "Cuisine enduits plafonds",
    "cuisine_revetement_sol":      "Cuisine revêtement de sol",
    "commentaire_amiex_1":         "Commentaire Amiex",
    "commentaire_amiex_2":         "Commentaire Amiex 2",
    "commentaire_amiex_3":         "Commentaire Amiex 3",
}

# Valeurs de référence attendues (pour validation)
VALEURS_DIAGNOSTIC = [
    "Absence d'amiante",
    "Présence d'amiante",
    "RESERVE",
    "Absence d'informations",
]



class RapportAmiante(BaseModel):
    # En-tête
    reference_rapport: Optional[str]
    date_rapport: Optional[str]
    operateur_reperage: Optional[str]
    prestataire: Optional[str]
    adresse: Optional[str]
    batiment: Optional[str]
    etage: Optional[str]
    porte: Optional[str]
    reserves: Optional[str]
    materiaux_amiantes: Optional[str]
    localisation: Optional[str]
    nombre_prelevements: Optional[int]

    # Cuisine
    cuisine_sol: Optional[str]
    cuisine_murs: Optional[str]
    cuisine_plafond: Optional[str]
    cuisine_faience: Optional[str]
    cuisine_evier: Optional[str]

    # Salle d'eau
    sdb_sol: Optional[str]
    sdb_murs: Optional[str]
    sdb_plafonds: Optional[str]
    sdb_faience: Optional[str]

    # WC
    wc_sol: Optional[str]
    wc_murs: Optional[str]
    wc_plafond: Optional[str]

    # Autres
    loggia_balcon: Optional[str]
    celliers: Optional[str]
    autre: Optional[str]

    # Commentaires
    commentaire_1: Optional[str]
    commentaire_2: Optional[str]
    commentaire_3: Optional[str]