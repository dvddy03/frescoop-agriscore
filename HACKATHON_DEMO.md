# AgriScore by FresCoop — Démo Hackathon GIM-UEMOA 2026

> **Route de la démo : `/agriscore`**
> *(alias équivalents : `/demo-agriscore`, `/bancabilite-demo`)*

---

## Pitch en 30 secondes

Les producteurs agricoles ouest-africains ne manquent pas d'activité —
**ils manquent de preuves**. Sans historique bancaire formel, les banques et
SFD ne peuvent pas leur prêter.

**AgriScore by FresCoop** transforme les preuves du terrain — ventes,
paiements mobiles, lots tracés, attestations coopératives, visites d'agent —
en **langage bancaire** : un score de bancabilité 0–100, un grade A/B/C/D et
un **dossier de crédit vérifiable**, généré **en moins de 5 minutes**.

> *« Nous ne prêtons pas. Nous rendons les agriculteurs finançables. »*

---

## Scénario de démo (parcours en 4 écrans)

La démo se présente seule. Un bouton **« Lancer la démo jury »** et une barre
d'étapes permettent de naviguer. Profil mis en avant : **Awa Diop**.

| Écran | Contenu | Message clé |
| ----- | ------- | ----------- |
| **1 · Agriculteur invisible** | Profil d'Awa Diop + cartes « Avant / Avec FresCoop » | Le problème n'est pas l'activité, c'est la preuve. |
| **2 · Preuves économiques** | 10 preuves (ventes, paiements, lots, attestation, agent) + timeline | Chaque vente devient une preuve vérifiable. |
| **3 · Score de bancabilité** | Score 78/100, grade B, détail des 7 critères + simulateur | Un score transparent et explicable. |
| **4 · Dossier banque / SFD** | Dossier vérifiable, QR code, boutons de décision | La banque pré-approuve un dossier, pas une déclaration. |

**Fonctionnalité WOW** — le simulateur « *Et si Awa vend 3× plus ce mois-ci ?* »
fait passer le score de **78 → 88** et le montant recommandé de
**350 000 → 580 000 FCFA** (Awa passe du grade B au grade A).

**Portefeuille de démonstration** — 3 profils sélectionnables :

| Producteur | Score | Grade | Statut |
| ---------- | ----- | ----- | ------ |
| Awa Diop | 78 | B | Éligible |
| Moussa Ba | 61 | C | Complément requis |
| Fatou Ndiaye | 38 | D | Non encore éligible |

---

## Identifiants de test

**Aucun.** La page `/agriscore` est **publique et autonome** : pas de
connexion, pas d'appel backend, données 100 % locales. Elle fonctionne même
hors-ligne une fois chargée.

---

## Script de présentation (5–7 min)

1. *« Voici Awa, productrice d'oignons à Thiès. Elle vend réellement, mais
   elle reste invisible pour les banques. »*
2. *« FresCoop capte ses ventes, ses paiements, ses lots tracés et ses
   attestations — automatiquement. »*
3. *« Ces preuves construisent un score de bancabilité transparent : 78/100,
   grade B. Chaque point est expliqué. »*
4. *« Et si Awa enregistre plus d'activité ? »* → cliquer sur le simulateur :
   le score monte, le montant recommandé aussi.
5. *« La banque, elle, consulte un dossier vérifiable — pas une simple
   déclaration : score, preuves, code de vérification, QR code. »*
6. Cliquer sur **Pré-approuver** → *« Elle pré-approuve un financement adapté
   au cycle agricole. La décision finale lui appartient. »*
7. *« FresCoop ne prête pas. FresCoop rend les agriculteurs finançables. »*

---

## Points forts

- **Une seule promesse, démontrée de bout en bout** : agriculteur invisible
  → dossier de crédit vérifiable.
- **Score transparent** : 7 critères pondérés, logique lisible
  (`calculateAgriScore`), aucun modèle opaque.
- **Simulateur interactif** : montre comment l'agriculteur devient finançable.
- **Vue partenaire finance crédible** : dossier, QR, décision, traçabilité.
- **Démo robuste** : autonome, sans dépendance réseau, déployable en ligne.
- **Design hackathon-ready** : responsive, mode présentation plein écran,
  export PDF (impression).

---

## Limites assumées

- Le QR code est **simulé visuellement** (motif déterministe) : il illustre
  la vérification, sans service de vérification externe réel.
- Le scoring est une **logique de règles transparente**, pas un modèle de
  machine learning — c'est un choix assumé (lisibilité pour le jury).
- Les données sont des **données de démonstration locales** ; la version
  plateforme branche ce moteur sur les vraies ventes / paiements / lots.
- La pré-approbation est **simulée côté interface** (pas d'écriture backend
  sur la démo `/agriscore`).

---

## Roadmap après le hackathon

- Brancher `calculateAgriScore` sur les vraies entités de la plateforme
  (`orders`, `paymentRecords`, `lots`, `attestations`).
- Génération PDF native du dossier de crédit + signature/horodatage.
- QR code réel pointant vers une page de vérification authentifiée banque/SFD.
- API partenaire finance : consultation de portefeuille, décisions tracées.
- Affinage du modèle de score avec historique réel et retours des SFD.
- Parcours USSD pour les producteurs sans smartphone.

---

## Détails techniques (pour les développeurs)

- **Route** : `/agriscore` — parcours public ajouté dans `src/App.jsx`
  (early-return avant le mur d'authentification, comme `/verifier`).
- **Composant** : `src/AgriScoreDemoPage.jsx` (autonome, styles isolés
  `src/agriscore.css`, préfixe `.ags-`).
- **Données + moteur de score** : `src/data/agriscoreDemoData.js`
  (`FARMERS`, `PROOFS`, `TIMELINE`, `IMPACT_METRICS`, `calculateAgriScore`,
  `boostedFarmer`).
- **Aucune modification** du backend, de l'authentification ou des autres
  pages. Build et tests existants inchangés et fonctionnels.

Voir **`DEPLOYMENT.md`** pour la mise en ligne.
