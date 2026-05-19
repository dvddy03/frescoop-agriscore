# Déploiement — FresCoop / AgriScore

Démo hackathon **AgriScore by FresCoop** — Filières Agricoles UEMOA 2026.
Route de la démo : **`/agriscore`** (alias : `/demo-agriscore`, `/bancabilite-demo`).

L'application est un front React (Vite) servi par un serveur Node natif
(`server/index.js`) qui sert aussi l'API. Le même process sert le dossier
`dist/` et expose `/api/*`.

---

## Commandes locales

```bash
npm install          # installer les dépendances
npm run dev          # développement : Vite (5173) + API locale (4174)
npm run build        # build de production -> dossier dist/
npm run start        # sert dist/ + API sur le PORT (4174 par défaut)
npm test             # smoke tests
npm run test:unit    # tests unitaires Vitest
```

Vérification rapide du build de production en local :

```bash
npm run build
npm run start
# puis ouvrir http://127.0.0.1:4174/agriscore
```

---

## Option recommandée : Railway

1. Pousser le code sur GitHub.
2. Aller sur [railway.app](https://railway.app).
3. **New Project → Deploy from GitHub repo**.
4. Sélectionner le dépôt `frescoopuemoa-v2`.
5. Ajouter les variables d'environnement :

   ```
   TOKEN_SECRET=<chaîne aléatoire longue et stable>
   FRESCOOP_SEED_MODE=demo
   FRESCOOP_REQUIRE_MONGODB=false
   NODE_ENV=production
   ```

6. **Build command** : `npm ci && npm run build`
   *(déjà défini dans `railway.json` et `nixpacks.toml`)*
7. **Start command** : `node server/index.js` *(équivalent de `npm run start`)*
8. Railway fournit automatiquement `PORT` — le serveur l'utilise déjà
   (`process.env.PORT`).
9. Vérifier le healthcheck : `https://<votre-app>.up.railway.app/api/health`
   doit répondre `{"ok":true,...}`.
10. Ouvrir la démo : `https://<votre-app>.up.railway.app/agriscore`.

> Le projet contient déjà `railway.json` et `nixpacks.toml` (Node 22).
> Aucun `Procfile` n'est nécessaire.

---

## Option de secours : Render

1. **New → Web Service**, connecter le dépôt GitHub.
2. **Build command** : `npm install && npm run build`
3. **Start command** : `npm run start`
4. Variables d'environnement :

   ```
   NODE_ENV=production
   TOKEN_SECRET=<chaîne aléatoire longue et stable>
   FRESCOOP_SEED_MODE=demo
   FRESCOOP_REQUIRE_MONGODB=false
   ```

5. Render fournit `PORT` automatiquement — déjà géré par le serveur.

---

## Variables d'environnement

| Variable                   | Démo hackathon          | Rôle                                                     |
| --------------------------- | ----------------------- | -------------------------------------------------------- |
| `PORT`                      | *(fourni par l'hôte)*   | Port d'écoute du serveur.                                |
| `TOKEN_SECRET`              | chaîne aléatoire longue | Signature des tokens d'authentification.                 |
| `FRESCOOP_SEED_MODE`        | `demo`                  | Charge les données de démonstration.                     |
| `FRESCOOP_REQUIRE_MONGODB`  | `false`                 | N'impose pas MongoDB ; fallback fichier JSON local.      |
| `NODE_ENV`                  | `production`            | Mode production.                                         |
| `MONGODB_URI`               | *(vide)*                | Optionnel — non requis pour la démo.                     |
| `PAYDUNYA_MODE`             | `test`                  | Optionnel — aucune vraie clé PayDunya nécessaire.        |
| `VITE_API_URL`              | *(vide)*                | Optionnel — l'API est servie par le même domaine.        |

**Important pour le hackathon :**

- `FRESCOOP_SEED_MODE=demo` : les données de démo sont disponibles.
- Le serveur **démarre toujours**, même sans `MONGODB_URI` (fallback fichier JSON).
- Aucune vraie clé PayDunya n'est nécessaire : l'app ne plante pas sans.
- La page **`/agriscore` est 100 % autonome** : données locales, aucun appel
  backend — elle fonctionne même si l'API est indisponible.

---

## Check-list avant le jury

- [ ] `npm run build` se termine sans erreur.
- [ ] Page d'accueil accessible (`/`).
- [ ] Page démo accessible (`/agriscore`) — y compris en rechargeant la page
      (fallback SPA vérifié).
- [ ] Le score s'affiche et la jauge s'anime.
- [ ] Le détail du score (7 critères) s'affiche.
- [ ] Le simulateur « 3× plus de ventes » change le score.
- [ ] Le dossier banque et le QR code s'affichent.
- [ ] Le bouton **Pré-approuver** affiche bien l'état de succès.
- [ ] Aucune erreur console critique.
- [ ] Affichage responsive (mobile + écran de présentation).
- [ ] `/api/health` répond `{"ok":true}`.
