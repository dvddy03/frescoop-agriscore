/**
 * AgriScore by FresCoop — données de démo + moteur de scoring.
 *
 * Tout est local : aucune dépendance backend pour la démo jury.
 * Le score est calculé par calculateAgriScore() — logique volontairement
 * simple, lisible et explicable.
 *
 *   « Nous ne prêtons pas. Nous rendons les agriculteurs finançables. »
 */

/* -------------------------------------------------------------------------- */
/* 1. Critères de score (total = 100 points)                                  */
/* -------------------------------------------------------------------------- */

export const SCORE_CRITERIA = [
  {
    key: 'verifiedTransactions',
    label: 'Transactions vérifiées',
    max: 25,
    hint: 'Ventes confirmées et tracées sur la plateforme.',
    advice: 'Enregistrer davantage de ventes confirmées sur FresCoop.',
  },
  {
    key: 'mobilePayments',
    label: 'Paiements mobiles confirmés',
    max: 20,
    hint: 'Encaissements Wave / Orange Money / PayDunya vérifiés.',
    advice: 'Encaisser les ventes via paiement mobile vérifié.',
  },
  {
    key: 'salesRegularity',
    label: 'Régularité des ventes',
    max: 15,
    hint: 'Constance de l’activité commerciale dans le temps.',
    advice: 'Vendre de façon régulière sur plusieurs semaines.',
  },
  {
    key: 'cooperativeAttestation',
    label: 'Attestation coopérative',
    max: 10,
    hint: 'Attestation d’appartenance et d’activité validée par la coopérative.',
    advice: 'Faire valider une attestation par la coopérative.',
  },
  {
    key: 'fieldAgentVisit',
    label: 'Visite agent terrain',
    max: 10,
    hint: 'Contrôle physique de l’exploitation par un agent FresCoop.',
    advice: 'Planifier une visite de vérification par un agent terrain.',
  },
  {
    key: 'tracedLots',
    label: 'Lots tracés',
    max: 10,
    hint: 'Lots suivis avec QR code, hub froid et capteurs.',
    advice: 'Tracer les lots de récolte avec QR code.',
  },
  {
    key: 'monthlyIncome',
    label: 'Revenu mensuel moyen',
    max: 10,
    hint: 'Revenu agricole moyen estimé à partir des ventes vérifiées.',
    advice: 'Consolider un revenu mensuel régulier et vérifiable.',
  },
];

/* -------------------------------------------------------------------------- */
/* 2. Moteur de scoring — calculateAgriScore(farmer, proofs)                   */
/* -------------------------------------------------------------------------- */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Sous-score par critère, à partir de l'activité réelle de l'agriculteur. */
function scoreCriterion(key, activity) {
  switch (key) {
    case 'verifiedTransactions':
      return clamp(Math.round(activity.verifiedSales * 2.75), 0, 25);
    case 'mobilePayments':
      return clamp(Math.round(activity.verifiedPayments * 3.6), 0, 20);
    case 'salesRegularity':
      return clamp(Math.round((activity.consistencyPct / 100) * 15), 0, 15);
    case 'cooperativeAttestation':
      return activity.hasCoopAttestation ? 10 : 0;
    case 'fieldAgentVisit':
      return activity.hasFieldAgentVisit ? 10 : 0;
    case 'tracedLots':
      return clamp(activity.tracedLots * 4, 0, 10);
    case 'monthlyIncome':
      return clamp(Math.round(activity.avgMonthlyIncome / 50000), 0, 10);
    default:
      return 0;
  }
}

/** Grade A/B/C/D à partir du score total. */
export function gradeFromScore(score) {
  if (score >= 85) return { grade: 'A', label: 'Très fiable', status: 'Éligible' };
  if (score >= 70) return { grade: 'B', label: 'Éligible', status: 'Éligible' };
  if (score >= 50) return { grade: 'C', label: 'Complément requis', status: 'Complément requis' };
  return { grade: 'D', label: 'Non éligible', status: 'Non encore éligible' };
}

/** Montant de crédit recommandé, fonction lisible du score et du grade. */
export function recommendedAmountFor(score, grade) {
  if (grade === 'D') return 0;
  if (grade === 'C') return 150000;
  if (grade === 'B') return clamp(350000 + (score - 78) * 25000, 250000, 550000);
  return clamp(550000 + (score - 85) * 10000, 550000, 700000); // grade A
}

/** Niveau de risque dérivé du score. */
function riskFromScore(score) {
  if (score >= 85) return 'Faible';
  if (score >= 70) return 'Modéré';
  if (score >= 50) return 'Élevé';
  return 'Très élevé';
}

/**
 * Calcule le score de bancabilité complet d'un agriculteur.
 * @param {object} farmer  profil agriculteur (avec .activity)
 * @param {Array}  proofs  preuves économiques (optionnel, pour le décompte)
 */
export function calculateAgriScore(farmer, proofs = []) {
  const activity = farmer.activity;

  const breakdown = SCORE_CRITERIA.map((criterion) => {
    const value = scoreCriterion(criterion.key, activity);
    return {
      key: criterion.key,
      label: criterion.label,
      hint: criterion.hint,
      advice: criterion.advice,
      value,
      max: criterion.max,
      pct: Math.round((value / criterion.max) * 100),
    };
  });

  const totalScore = breakdown.reduce((sum, item) => sum + item.value, 0);
  const { grade, label, status } = gradeFromScore(totalScore);
  const recommendedAmount = recommendedAmountFor(totalScore, grade);

  // Actions manquantes : tout critère sous 70 % de son maximum.
  const missingActions = breakdown
    .filter((item) => item.pct < 70)
    .sort((a, b) => a.pct - b.pct)
    .map((item) => ({
      label: item.label,
      advice: item.advice,
      gain: item.max - item.value,
    }));

  const verifiedProofs = proofs.filter((p) => p.status === 'Vérifié').length;

  return {
    totalScore,
    grade,
    gradeLabel: label,
    status,
    breakdown,
    recommendedAmount,
    recommendedDurationMonths: grade === 'A' ? 6 : 5,
    repayment: 'Remboursement après récolte',
    risk: riskFromScore(totalScore),
    dataConfidence: verifiedProofs >= 7 ? 'Élevée' : verifiedProofs >= 4 ? 'Moyenne' : 'À renforcer',
    missingActions,
  };
}

/* -------------------------------------------------------------------------- */
/* 3. Profils agriculteurs de démo                                            */
/* -------------------------------------------------------------------------- */

export const FARMERS = [
  {
    id: 'awa-diop',
    name: 'Awa Diop',
    initials: 'AD',
    region: 'Thiès, Sénégal',
    filiere: 'Oignon / maraîchage',
    cooperative: 'Coopérative des Niayes',
    phone: '+221 77 000 12 34',
    objective: 'Obtenir un financement de campagne agricole',
    problem: 'Pas d’historique bancaire formel',
    fieldAgent: 'Mamadou Sow — agent terrain FresCoop',
    verificationCode: 'FRES-AWA-2026-042',
    consentGranted: true,
    consentDate: '2026-05-06',
    dataFreshness: '2026-05-06',
    requestedAmount: 400000,
    activity: {
      verifiedSales: 8,
      verifiedPayments: 4,
      consistencyPct: 93,
      hasCoopAttestation: true,
      hasFieldAgentVisit: true,
      tracedLots: 1,
      avgMonthlyIncome: 210000,
    },
  },
  {
    id: 'moussa-ba',
    name: 'Moussa Ba',
    initials: 'MB',
    region: 'Saint-Louis, Sénégal',
    filiere: 'Riz / céréales',
    cooperative: 'Coopérative de la Vallée',
    phone: '+221 76 555 88 21',
    objective: 'Financer l’achat de semences et d’intrants',
    problem: 'Activité réelle mais preuves incomplètes',
    fieldAgent: 'En attente d’affectation',
    verificationCode: 'FRES-MOU-2026-088',
    consentGranted: true,
    consentDate: '2026-05-04',
    dataFreshness: '2026-05-04',
    requestedAmount: 250000,
    activity: {
      verifiedSales: 7,
      verifiedPayments: 2,
      consistencyPct: 80,
      hasCoopAttestation: false,
      hasFieldAgentVisit: true,
      tracedLots: 2,
      avgMonthlyIncome: 240000,
    },
  },
  {
    id: 'fatou-ndiaye',
    name: 'Fatou Ndiaye',
    initials: 'FN',
    region: 'Kaolack, Sénégal',
    filiere: 'Arachide / maraîchage',
    cooperative: 'Coopérative du Saloum',
    phone: '+221 70 222 47 09',
    objective: 'Lancer une première campagne maraîchère',
    problem: 'Très peu d’activité enregistrée à ce jour',
    fieldAgent: 'Visite réalisée, preuves à compléter',
    verificationCode: 'FRES-FAT-2026-115',
    consentGranted: true,
    consentDate: '2026-05-02',
    dataFreshness: '2026-05-02',
    requestedAmount: 200000,
    activity: {
      verifiedSales: 4,
      verifiedPayments: 1,
      consistencyPct: 67,
      hasCoopAttestation: false,
      hasFieldAgentVisit: true,
      tracedLots: 0,
      avgMonthlyIncome: 130000,
    },
  },
];

/* -------------------------------------------------------------------------- */
/* 4. Preuves économiques par agriculteur                                     */
/* -------------------------------------------------------------------------- */

/** sources : marketplace | paiement | agent | cooperative | lot | document */
export const PROOFS = {
  'awa-diop': [
    { id: 'p1', title: 'Vente confirmée — 320 kg d’oignons', detail: '176 000 FCFA', source: 'marketplace', status: 'Vérifié', date: '2026-04-15', impact: '+ Transactions vérifiées' },
    { id: 'p2', title: 'Vente confirmée — 180 kg de tomates', detail: '126 000 FCFA', source: 'marketplace', status: 'Vérifié', date: '2026-04-10', impact: '+ Transactions vérifiées' },
    { id: 'p3', title: 'Vente confirmée — 250 kg d’oignons', detail: '137 500 FCFA', source: 'marketplace', status: 'Vérifié', date: '2026-04-22', impact: '+ Régularité des ventes' },
    { id: 'p4', title: 'Paiement Wave vérifié', detail: '176 000 FCFA', source: 'paiement', status: 'Vérifié', date: '2026-04-18', impact: '+ Paiements mobiles' },
    { id: 'p5', title: 'Paiement Orange Money vérifié', detail: '126 000 FCFA', source: 'paiement', status: 'Vérifié', date: '2026-04-12', impact: '+ Paiements mobiles' },
    { id: 'p6', title: 'Lot tracé QR — LOT-NIAYES-042', detail: 'Jumeau numérique actif', source: 'lot', status: 'Vérifié', date: '2026-04-20', impact: '+ Lots tracés' },
    { id: 'p7', title: 'Température hub froid — 8 °C stable', detail: 'Capteur micro-hub solaire', source: 'lot', status: 'Vérifié', date: '2026-04-21', impact: '+ Lots tracés' },
    { id: 'p8', title: 'Attestation coopérative validée', detail: 'Coopérative des Niayes', source: 'cooperative', status: 'Vérifié', date: '2026-04-30', impact: '+ Attestation coopérative' },
    { id: 'p9', title: 'Visite agent terrain validée', detail: 'Exploitation contrôlée sur site', source: 'agent', status: 'Vérifié', date: '2026-05-05', impact: '+ Visite agent terrain' },
    { id: 'p10', title: 'Reçu achat intrants', detail: '85 000 FCFA', source: 'document', status: 'En attente', date: '2026-05-08', impact: 'Pièce en cours de contrôle' },
  ],
  'moussa-ba': [
    { id: 'm1', title: 'Vente confirmée — 400 kg de riz', detail: '220 000 FCFA', source: 'marketplace', status: 'Vérifié', date: '2026-04-14', impact: '+ Transactions vérifiées' },
    { id: 'm2', title: 'Vente confirmée — 300 kg de riz', detail: '165 000 FCFA', source: 'marketplace', status: 'Vérifié', date: '2026-04-25', impact: '+ Transactions vérifiées' },
    { id: 'm3', title: 'Paiement Wave vérifié', detail: '220 000 FCFA', source: 'paiement', status: 'Vérifié', date: '2026-04-16', impact: '+ Paiements mobiles' },
    { id: 'm4', title: 'Lot tracé QR — LOT-VALLEE-019', detail: 'Jumeau numérique actif', source: 'lot', status: 'Vérifié', date: '2026-04-26', impact: '+ Lots tracés' },
    { id: 'm5', title: 'Visite agent terrain validée', detail: 'Exploitation contrôlée sur site', source: 'agent', status: 'Vérifié', date: '2026-05-03', impact: '+ Visite agent terrain' },
    { id: 'm6', title: 'Attestation coopérative', detail: 'Coopérative de la Vallée', source: 'cooperative', status: 'En attente', date: '2026-05-07', impact: 'Attestation à valider' },
    { id: 'm7', title: 'Paiement mobile non confirmé', detail: 'Référence introuvable', source: 'paiement', status: 'Refusé', date: '2026-05-08', impact: 'Preuve rejetée' },
  ],
  'fatou-ndiaye': [
    { id: 'f1', title: 'Vente confirmée — 120 kg d’arachides', detail: '78 000 FCFA', source: 'marketplace', status: 'Vérifié', date: '2026-04-19', impact: '+ Transactions vérifiées' },
    { id: 'f2', title: 'Vente confirmée — 90 kg de légumes', detail: '52 000 FCFA', source: 'marketplace', status: 'Vérifié', date: '2026-04-28', impact: '+ Transactions vérifiées' },
    { id: 'f3', title: 'Paiement Orange Money', detail: '78 000 FCFA', source: 'paiement', status: 'Vérifié', date: '2026-04-21', impact: '+ Paiements mobiles' },
    { id: 'f4', title: 'Visite agent terrain validée', detail: 'Exploitation contrôlée sur site', source: 'agent', status: 'Vérifié', date: '2026-05-02', impact: '+ Visite agent terrain' },
    { id: 'f5', title: 'Déclaration de vente informelle', detail: 'Sans preuve de paiement', source: 'document', status: 'En attente', date: '2026-05-05', impact: 'Preuve à compléter' },
    { id: 'f6', title: 'Attestation coopérative', detail: 'Coopérative du Saloum', source: 'cooperative', status: 'En attente', date: '2026-05-06', impact: 'Attestation à valider' },
  ],
};

/* -------------------------------------------------------------------------- */
/* 5. Timeline économique (agriculteur mis en avant : Awa)                     */
/* -------------------------------------------------------------------------- */

export const TIMELINE = {
  'awa-diop': [
    { date: '15 avril', label: 'Vente d’oignons confirmée', source: 'marketplace' },
    { date: '18 avril', label: 'Paiement Wave reçu', source: 'paiement' },
    { date: '22 avril', label: 'Livraison confirmée', source: 'lot' },
    { date: '30 avril', label: 'Attestation coopérative ajoutée', source: 'cooperative' },
    { date: '5 mai', label: 'Visite agent terrain validée', source: 'agent' },
    { date: '6 mai', label: 'Score de bancabilité mis à jour', source: 'score' },
  ],
  'moussa-ba': [
    { date: '14 avril', label: 'Vente de riz confirmée', source: 'marketplace' },
    { date: '16 avril', label: 'Paiement Wave reçu', source: 'paiement' },
    { date: '26 avril', label: 'Lot tracé enregistré', source: 'lot' },
    { date: '3 mai', label: 'Visite agent terrain validée', source: 'agent' },
    { date: '7 mai', label: 'Attestation coopérative en attente', source: 'cooperative' },
  ],
  'fatou-ndiaye': [
    { date: '19 avril', label: 'Première vente confirmée', source: 'marketplace' },
    { date: '21 avril', label: 'Paiement Orange Money reçu', source: 'paiement' },
    { date: '2 mai', label: 'Visite agent terrain validée', source: 'agent' },
    { date: '6 mai', label: 'Attestation coopérative en attente', source: 'cooperative' },
  ],
};

/* -------------------------------------------------------------------------- */
/* 6. Simulation « Et si Awa vend 3 fois de plus ce mois-ci ? »                */
/* -------------------------------------------------------------------------- */

/**
 * Renvoie une copie de l'agriculteur dont l'activité commerciale est
 * triplée pour le mois en cours. Les preuves structurelles (attestation,
 * visite agent, lots) ne changent pas — seul le volume d'activité augmente.
 */
export function boostedFarmer(farmer) {
  return {
    ...farmer,
    activity: {
      ...farmer.activity,
      verifiedSales: farmer.activity.verifiedSales * 3,
      verifiedPayments: farmer.activity.verifiedPayments * 3,
      consistencyPct: 100,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 7. Indicateurs d'impact UEMOA                                              */
/* -------------------------------------------------------------------------- */

export const IMPACT_METRICS = [
  { value: '< 5 min', label: 'Dossier de crédit vérifiable généré', sub: 'contre plusieurs semaines d’instruction classique' },
  { value: '1 240', label: 'Producteurs rendus finançables', sub: 'sur les filières pilotes UEMOA' },
  { value: '312 M', label: 'FCFA de crédit débloqué', sub: 'par les banques et SFD partenaires' },
  { value: '68 %', label: 'de femmes productrices', sub: 'incluses dans le portefeuille agricole' },
];
