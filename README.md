# FresCoop Filières Agricoles UEMOA 2026

Adaptation du projet FresCoop pour le Hackathon Filières Agricoles organisé par le GIM-UEMOA.

FresCoop répond au **problème n°4 — l'accès au financement agricole** : un score de crédit agricole vérifiable pour producteurs, coopératives et SFD.

Le cœur de produit est le **scoring de bancabilité**. Chaque vente, paiement et preuve de livraison enregistrés sur la plateforme alimente un dossier de crédit portable, lisible par les banques, SFD, fintechs et acheteurs B2B. La traçabilité du lot et le paiement partenaire ne sont pas une fin en soi : ils produisent la preuve économique qui rend l'agriculteur bancable.

## Lancer

```bash
npm install
npm run dev
```

URL locale Vite: `http://127.0.0.1:5173/`

Le script `dev` lance aussi l’API locale FresCoop sur `http://127.0.0.1:4174/api`.

## Mode production local

```bash
npm run build
npm run start
```

URL application + API: `http://127.0.0.1:4174/`

Les données applicatives sont persistées dans `server/data/store.json` en local et restent exportables depuis la page Données.

## MongoDB Atlas en production

Pour eviter que les donnees de demonstration reviennent apres une suppression, utilisez Atlas comme source de verite et desactivez le seed automatique sur l'environnement de production.

Variables a configurer sur Railway:

```bash
MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=frescoop
FRESCOOP_REQUIRE_MONGODB=true
FRESCOOP_SEED_MODE=none
TOKEN_SECRET=une-longue-cle-aleatoire-stable
```

Avec `MONGODB_URI`, le serveur cree la collection `store` au premier demarrage sans charger `server/seed-data.json`, sauf si `FRESCOOP_SEED_MODE=demo` est force. `FRESCOOP_REQUIRE_MONGODB=true` empeche un fallback discret vers `server/data/store.json` si Atlas est inaccessible.

Pour migrer le fichier local actuel vers Atlas une seule fois:

```bash
npm run migrate:atlas -- server/data/store.json
```

## Verifier

```bash
npm run build
```

## Ce que montre la démo UEMOA

- Score de bancabilité calculé en temps réel à partir des ventes, paiements et preuves de livraison.
- Dossier de crédit agricole et preuves économiques exportables pour banques, SFD et partenaires.
- Parcours du lot du champ au paiement vérifiable — chaque étape nourrit le score.
- Paiement partenaire (PayDunya) avec reçu vérifiable par QR code.
- Passeport économique consenti pour productrices, coopératives, collectrices et commerçants.
- Simulateur d’impact pour les filières agricoles UEMOA (pertes évitées, revenu additionnel, genre, CO2).
