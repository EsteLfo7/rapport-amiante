# Rapport Amiante - Application Desktop

Application desktop (.exe) construite avec **Tauri v1** + **React** + **TypeScript** pour le traitement par lots de rapports PDF amiante.

## Fonctionnalites

- **Glisser-deposer** de multiples fichiers PDF
- **Compteur** de fichiers et de lignes totales
- **Bouton START** pour lancer le traitement
- **Deux modes** de traitement :
  - `Rapide` : mode Gemini Flash (envoi PDF direct a l'API)
  - `Precis` : mode RAG (extraction texte + LLM leger)
- **Options d'export** : choix des colonnes Excel en sortie
  - Preset `Simple` : colonnes essentielles
  - Preset `Complet` : toutes les colonnes disponibles
  - Ajout/retrait de colonnes une par une

## Structure

```
app/
  index.html              # Point d'entree HTML
  package.json            # Dependances Node.js (React, Vite, Tauri)
  tsconfig.json           # Config TypeScript
  vite.config.ts          # Config Vite
  src/
    main.tsx              # Bootstrap React
    App.tsx               # Composant principal (UI)
    columns.ts            # Definitions COLUMNS_SIMPLE / COLUMNS_COMPLET
    index.css             # Styles dark theme
    components/
      ExportOptions.tsx   # Modal de gestion des colonnes d'export
  src-tauri/
    Cargo.toml            # Dependances Rust
    tauri.conf.json       # Configuration Tauri (fenetre, permissions, bundle)
    src/
      main.rs             # Entrypoint Rust / Tauri
      commands.rs         # Commandes Tauri (process_files)
```

## Prerequis

- **Node.js** >= 18
- **Rust** >= 1.60 (via [rustup](https://rustup.rs/))
- **Python** >= 3.10 avec les dependances du projet installees
- **Tauri CLI** : `npm install -g @tauri-apps/cli`

## Installation

```bash
cd app
npm install
```

## Developpement

```bash
npm run tauri dev
```

## Build (.exe)

```bash
npm run tauri build
```

L'executable se trouve dans `app/src-tauri/target/release/bundle/`.

## Architecture

Le frontend React communique avec le backend Python via une commande Tauri :

```
[React UI] --invoke('process_files', { paths, mode, columns })--> [Rust Tauri command]
                                                                       |
                                              [python rapport_amiante/main.py --mode ... --files ... --columns ...]
                                                                       |
                                                         [JSON result: { success, message, output_path }]
```

## Colonnes disponibles

Les colonnes correspondent aux cles de `COLUMNS_FR` dans `rapport_amiante/variables/var.py`.

### Simple (10 colonnes)
`reference_rapport`, `date_rapport`, `operateur_reperage`, `prestataire`, `adresse`, `batiment`, `etage`, `porte`, `reserves`, `conclusion_presence_amiante`

### Complet (25 colonnes)
Toutes les colonnes du dictionnaire `COLUMNS_FR`.
