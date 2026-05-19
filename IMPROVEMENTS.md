# Améliorations — AgriScore by FresCoop

Itération d'amélioration de la démo hackathon, suite aux tests de la version
en ligne. Référence : `prompt.md`.

---

## 🐛 Correctif critique — la démo était redirigée vers `/login`

**Cause racine identifiée.** La route `/agriscore` n'était pas déclarée comme
route publique. Sur le site en ligne, le store se synchronise avec la base de
données (qui contient des utilisateurs) ; un effet de `App.jsx` appliquait alors
`navigate('/login')` dès que `store.users.length > 0 && !currentUser`, **même
sur `/agriscore`**. La démo était éjectée vers la page de connexion.

**Correctif.** Ajout d'un tableau `agriScorePaths` et `isPublicPath()` renvoie
désormais `true` pour les routes de la démo → l'effet de redirection sort avant
d'agir. La démo jury est garantie accessible **sans authentification**.

---

## Fichiers créés / modifiés

| Fichier | Nature | Détail |
| ------- | ------ | ------ |
| `src/AgriScoreDemoPage.jsx` | **réécrit** | Mode pas-à-pas (DemoRunner), mode présentation, ancres, pédagogie |
| `src/agriscore.css` | modifié | Styles du runner, barre de contrôle, pédagogie |
| `src/App.jsx` | modifié | `agriScorePaths`, `isPublicPath`, route `/public/agriscore`, validation inscription, page « en attente » |
| `src/styles.css` | modifié | Styles de validation par champ (`.field-error-text`) |
| `src/data/agriscoreDemoData.js` | inchangé | Données + moteur `calculateAgriScore` |
| `IMPROVEMENTS.md` | **créé** | Ce fichier |

---

## Détail des améliorations (objectifs `prompt.md`)

### 1. Bouton « Lancer la démo jury » corrigé
Le bouton ne redirige plus vers `/login`. Il **lance le parcours pas-à-pas**
(DemoRunner) à l'écran 1. La démo ne nécessite aucune authentification.

### 2. Démo interactive et autonome — DemoRunner
Nouveau **mode pas-à-pas** intégré à `AgriScoreDemoPage` :
- état `view` (`scroll` | `step`) et `step` (0–3) ;
- boutons **Précédent / Suivant**, fil d'étapes cliquable, points de progression ;
- chaque écran (Agriculteur → Preuves → Score → Dossier) s'affiche seul ;
- clic sur une carte du portfolio (Awa Diop 78/B, Moussa Ba 61/C,
  Fatou Ndiaye 38/D) → recharge tout le détail du profil.

### 3. Mode présentation
Bouton **« Mode présentation »** : plein écran + **auto-défilement toutes les
9 secondes** + en-tête/navigation masqués. Bouton **Lecture auto / Pause** dans
la barre de contrôle. Sortie via Échap ou « Quitter ».

### 4. Messages d'erreur sur le formulaire d'inscription
Le composant `Field` accepte une prop `error`. Le formulaire d'inscription
(`LoginPage`) valide chaque champ obligatoire et affiche **« Ce champ est
requis »** (ou « Adresse email invalide », « Au moins 6 caractères ») sous le
champ concerné, avec mise en évidence visuelle. L'erreur disparaît à la saisie.

### 5. Expérience post-inscription
Sur la page « Inscription en attente » :
- bouton **« Retour à la démo AgriScore »** (→ `/public/agriscore`) ;
- bouton **« Se déconnecter »** (déjà présent, conservé) ;
- nouveau bloc **« Comment atteindre 30 points »** listant les preuves et leur
  valeur en points (carte coopérative +25, attestation chef +20, etc.) +
  lien vers la page de soumission des preuves.

### 6. Contenu et pédagogie
- La phrase forte **« Nous ne prêtons pas. Nous rendons les agriculteurs
  finançables. »** est rappelée dans le hero, l'en-tête du runner et le dossier.
- Nouveau bloc **« Comment une preuve devient un point »** dans l'écran Preuves :
  explique la conversion ventes / paiements / attestations → critères de score.

### 7. Routing et ancres
- Nouvelle route **`/public/agriscore`** (en plus de `/agriscore`,
  `/demo-agriscore`, `/bancabilite-demo`).
- Ancres fonctionnelles : `/public/agriscore#preuves`, `#score`, `#dossier`,
  `#agriculteur` — au chargement, la page défile vers la bonne section ; les
  items du menu « 1 · Agriculteur / 2 · Preuves / 3 · Score / 4 · Dossier »
  mettent l'URL à jour.

### 8. Contraintes respectées
- Aucune modification de la logique de paiement ni du serveur.
- Pas de refonte d'architecture : seuls des composants/routes ont été ajoutés.
- Charte visuelle conservée (vert agricole, touches dorées, cartes arrondies).

---

## Tester la démo sans se connecter

1. Ouvrir **`/public/agriscore`** (ou `/agriscore`) — aucune connexion requise.
2. Cliquer **« Lancer la démo jury »** → parcours guidé Précédent / Suivant.
3. Cliquer **« Mode présentation »** → plein écran auto-défilant (9 s/écran).
4. Tester les ancres directes : `/public/agriscore#score`.
5. Changer de profil via le portfolio (Awa / Moussa / Fatou).

Local :
```bash
npm install
npm run build
npm run start      # http://127.0.0.1:4174/public/agriscore
```

---

## Hypothèses et limites restantes

- La page d'accueil `/` et la connexion utilisent l'API distante définie dans
  `vercel.json` ; **la démo `/agriscore` reste autonome** et ne dépend de rien.
- Le QR code est un motif simulé déterministe (pas de service de vérification
  externe réel).
- Le moteur de score est une logique de règles transparente (pas de modèle ML) —
  choix assumé pour la lisibilité jury.
- La validation d'inscription est côté client ; le serveur garde sa propre
  validation. La pré-approbation reste simulée côté interface.
- Le mode présentation s'arrête au dernier écran (pas de boucle automatique).
