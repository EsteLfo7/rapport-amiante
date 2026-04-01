

def build_prompt(config: dict) -> str:

  

    return f"""
Tu analyses un rapport de diagnostic amiante et tu remplis UNE ligne d'un tableau.

## 1. Champs généraux
- reference_rapport : identifiant unique du rapport.
- date_rapport : date au format JJ/MM/AAAA.
- operateur_reperage : Nom et prénom de la personne physique ayant réalisé le repérage.
  Peut être null si non mentionné. Différent du prestataire (société).
- prestataire : Nom court ou acronyme de la société prestataire.
- adresse : Adresse postale seulement Ex. : 123 Rue de la Paix, 75000 Paris. Ne pas inclure le nom du bâtiment, l'étage, la porte ou le logement dans ce champ.
- batiment :  référence du bâtiment ou hall si mentionnée (ex: A3, B2, HALL 53), si absent ne rien mettre.
- etage : code court de l'étage (ex: RDC, R+1, R+4, NC si non communiqué), si absent ne rien mettre.
- porte : numéro ou code court du logement (ex: 80, 85, 5B), si absent ne rien mettre.
- reserves : Liste courte des éléments NON inspectés ou NON accessibles.
  Format : noms courts des éléments séparés par des virgules (max 80 caractères).
  Exemples : "sous-face sol, tablier baignoire, joints menuiseries, bac à douche".
  Ne jamais mentionner "pièces sèches" / "pièces humides" / texte réglementaire.
- materiaux_amiantes : Résumé court des type de matériau amiantés.
- localisation : Récapitulatif court des zones où des matériaux amiantés ont été trouvés.
- nombre_prelevements : nombre entier ou null.


## 2. Diagnostics par pièce
Légende stricte :
- "A" = matériau amianté détecté
- "N" = non amianté
- "R" = réserve : pièce présente mais non inspectée
- "?" = information indéterminée ou ambiguë dans le document
- null = pièce inexistante dans ce logement (ne pas remplir)

Champs concernés :
cuisine_sol, cuisine_murs, cuisine_plafond, cuisine_faience, cuisine_evier,
sdb_sol, sdb_murs, sdb_plafonds, sdb_faience,
wc_sol, wc_murs, wc_plafond,
loggia_balcon, celliers, autre.

Règles de conversion :
- "négatif", "absence d'amiante", "non amianté" → "N"
- "positif", "présence d'amiante", "amianté" → "A"
- "réserve", "non inspecté", "non accessible", "non visité" → "R"
- Si le document est ambigu sur la présence → "?"
- Si la pièce n'existe pas dans le logement → null (aucune valeur)
- Si la cellule est rouge ou mise en évidence visuellement → interpréter comme "A"


## 3. Commentaires
- commentaire_1, commentaire_2, commentaire_3 : Remarques courtes et utiles si précisés dans une section commentaire.
  Sans paragraphe réglementaire ni référence d'analyse. 


## 4. Règles générales
- Si un champ n'est pas clairement renseigné dans le document → null.
- Ne jamais inventer de valeur.
- Ne jamais écrire "Vol", "Volume" ou numéros de volume dans aucun champ.
- Ne pas inclure le mot "Lgt.", "Logement" ou des numéros de périmètre technique.
"""