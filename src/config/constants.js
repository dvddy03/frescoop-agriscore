export const API_BASE = import.meta.env.VITE_API_URL || '';

export const STORAGE_KEY = 'frescoop.production.roles.v2';
export const SESSION_KEY = 'frescoop.session.user';
export const CART_KEY = 'frescoop.cart';
export const HIDDEN_ORDERS_KEY = 'frescoop.hidden.orders';
export const MAX_FILE_SIZE = 2 * 1024 * 1024;
export const PRODUCT_PAGE_SIZE_OPTIONS = [6, 9, 12];
export const ORDER_PAGE_SIZE_OPTIONS = [5, 10, 20];

export const roles = [
  { id: 'admin', label: 'Admin', locked: true },
  { id: 'agriculteur', label: 'Agriculteur' },
  { id: 'agentTerrain', label: 'Agent Terrain' },
  { id: 'transporteur', label: 'Transporteur' },
  { id: 'client', label: 'Client' },
  { id: 'acheteurB2B', label: 'Acheteur B2B' },
  { id: 'partenaire', label: 'Partenaire finance' },
];

export const dossierTypes = [
  'Attestation producteur',
  'Attestation commercant',
  'Preuve économique',
  'Verification coopérative',
  'Demande logistique',
  'Autre demande',
];

export const dossierStatuses = ['Soumis', 'En verification', 'Valide', 'Rejete'];
export const productStatuses = ['Publie', 'Brouillon', 'Suspendu'];
export const orderStatuses = ['Paiement en attente', 'Nouvelle', 'Confirmee', 'En preparation', 'Livree', 'Annulee'];
export const paymentStatuses = ['Paye', 'Partiel', 'En attente', 'Litige'];
export const MARKET_PRICE_MAX_MARGIN = 100;

export const marketPriceReferences = [
  { key: 'oignon', label: 'Oignon', price: 350, unit: 'kg', source: 'Reference marche Dakar-Thies' },
  { key: 'riz', label: 'Riz local', price: 330, unit: 'kg', source: 'Reference marche Saint-Louis' },
  { key: 'carotte', label: 'Carotte', price: 220, unit: 'kg', source: 'Reference marche Dakar' },
  { key: 'tomate', label: 'Tomate', price: 260, unit: 'kg', source: 'Reference marche Thies' },
  { key: 'mangue', label: 'Mangue', price: 500, unit: 'kg', source: 'Reference marche Casamance' },
];

export const evidenceTypes = ['Piece identite', 'Registre coopérative', 'Photo activite', 'Facture', 'Recu paiement', 'Contrat', 'Autre preuve'];
export const chartColors = ['#1f835d', '#258399', '#e54d35', '#d99912', '#74526f'];

export const publicImages = {
  hero: '/sector-images/platform-home.jpg',
  auth: '/sector-images/auth-coopérative.jpg',
  market: '/sector-images/market-produce.jpg',
  products: '/sector-images/seller-products.jpg',
  dossiers: '/sector-images/documents-dossier.jpg',
  attestations: '/sector-images/certificate-attestation.jpg',
  proofs: '/sector-images/finance-proof.jpg',
  orders: '/sector-images/orders-commerce.jpg',
  operations: '/sector-images/warehouse-operations.jpg',
  admin: '/sector-images/admin-users.jpg',
  impact: '/sector-images/analytics-impact.jpg',
  data: '/sector-images/data-governance.jpg',
  agriculture: '/sector-images/sector-agriculture.jpg',
  commerce: '/sector-images/sector-commerce.jpg',
  logistics: '/sector-images/sector-logistics.jpg',
  account: '/sector-images/account-profile.jpg',
  uemoaMap: '/uemoa-map.svg',
  identity: '/frescoop-identity.svg',
  fallbackProduct: '/sector-images/fallback-product.jpg',
  fallbackHub: '/sector-images/fallback-hub.jpg',
};

export const publicSitePaths = [
  '/public',
  '/contact',
  '/sondage',
  '/questionnaire',
];

export const PROOF_TYPE_CONFIG = [
  { id: 'attestation_chef', label: 'Attestation du chef de village', points: 20, level: 1, requiresUpload: true, description: "Photo du document signé par le chef de village ou de communauté" },
  { id: 'carte_cooperative', label: 'Carte de membre coopérative', points: 25, level: 1, requiresUpload: true, description: "Photo de votre carte de membre d'une coopérative agricole" },
  { id: 'parrainage_agriculteurs', label: 'Parrainage par 2 agriculteurs', points: 15, level: 1, requiresUpload: false, description: "Deux agriculteurs déjà actifs sur FresCoop vous parrainent" },
  { id: 'mobile_money_agri', label: 'Mobile money (achats agricoles)', points: 15, level: 1, requiresUpload: true, description: "Capture écran de transactions mobile money liées à l'agriculture" },
  { id: 'historique_livraisons', label: 'Historique livraisons (3+)', points: 20, level: 1, requiresUpload: false, description: "Vérification automatique après 3 livraisons confirmées sur FresCoop" },
  { id: 'cni', label: "Carte nationale d'identité (CNI)", points: 25, level: 2, requiresUpload: true, description: "Photo recto-verso de votre CNI ou carte d'identité CEDEAO en cours de validité" },
  { id: 'recu_intrants', label: 'Reçu achat intrants', points: 15, level: 2, requiresUpload: true, description: "Reçu d'achat d'engrais, semences ou produits phytosanitaires" },
  { id: 'contrat_vente', label: 'Contrat ou reçu de vente', points: 15, level: 2, requiresUpload: true, description: "Contrat avec une coopérative ou reçu de vente de récolte" },
  { id: 'carte_exploitant', label: "Carte d'exploitant agricole", points: 30, level: 2, requiresUpload: true, description: "Carte officielle délivrée par le Ministère de l'Agriculture" },
  { id: 'visite_agent', label: 'Visite agent terrain FresCoop', points: 40, level: 2, requiresUpload: false, requiresAgent: true, description: "Choisissez l'agent qui vous a visité. Il recevra une demande de confirmation." },
];

export const PROOF_TYPE_CONFIG_TRANSPORTEUR = [
  { id: 'cni_transporteur', label: "Carte nationale d'identité (CNI)", points: 25, level: 1, requiresUpload: true, description: "Photo recto-verso de votre CNI ou carte d'identité CEDEAO en cours de validité" },
  { id: 'permis_conduire', label: 'Permis de conduire', points: 30, level: 1, requiresUpload: true, description: "Photo recto-verso de votre permis de conduire (catégorie B minimum)" },
  { id: 'carte_grise', label: 'Carte grise du véhicule', points: 25, level: 1, requiresUpload: true, description: "Photo de la carte grise ou attestation du propriétaire du véhicule" },
  { id: 'assurance_vehicule', label: 'Assurance véhicule', points: 20, level: 2, requiresUpload: true, description: "Attestation d'assurance du véhicule en cours de validité" },
  { id: 'photo_vehicule', label: 'Photo du véhicule', points: 15, level: 2, requiresUpload: true, description: "Photo de votre véhicule de transport (plaque visible)" },
  { id: 'visite_agent_transporteur', label: 'Visite agent terrain FresCoop', points: 40, level: 2, requiresUpload: false, requiresAgent: true, description: "Choisissez l'agent qui vous a visité. Il recevra une demande de confirmation." },
];

export function getProofConfigForRole(role) {
  if (role === 'transporteur') return PROOF_TYPE_CONFIG_TRANSPORTEUR;
  return PROOF_TYPE_CONFIG;
}
