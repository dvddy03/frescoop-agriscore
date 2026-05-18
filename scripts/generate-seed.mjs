import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const names = ['Fatou Diallo','Aissatou Ba','Aminata Sow','Khady Ndiaye','Mariame Fall','Awa Gueye','Coumba Diop','Binta Sarr','Ndeye Mbaye','Rokhaya Seck','Oumy Kane','Astou Faye','Penda Dieng','Dior Thiam','Khadija Ly','Mamadou Diop','Ibrahima Sy','Moussa Gueye','Abdoulaye Fall','Omar Sow','Cheikh Ndiaye','Alioune Ba','Modou Sarr','Boubacar Diallo','Samba Kane','Adama Faye','Souleymane Thiam','Demba Seck','Babacar Mbaye','Lamine Dieng','Fatou Sy','Aissatou Diop','Aminata Gueye','Khady Fall','Mariame Sow','Awa Ndiaye','Coumba Ba','Binta Diallo','Ndeye Sarr','Rokhaya Kane','Oumy Mbaye','Astou Seck','Penda Faye','Dior Dieng','Khadija Thiam','Mamadou Ly','Ibrahima Kane','Moussa Diop','Abdoulaye Sy','Omar Gueye'];
const productNames = ['Mangue Kent','Tomate cerise','Oignon violet','Gombo frais','Aubergine','Piment vert','Laitue','Carotte','Patate douce','Banane plantain','Papaye solo','Melon','Concombre','Haricot vert','Chou vert','Poivron rouge','Citron vert','Gingembre','Persil','Menthe'];
const categories = ['Fruits','Legumes','Legumes','Legumes','Legumes','Condiments','Legumes','Legumes','Tubercules','Fruits','Fruits','Fruits','Legumes','Legumes','Legumes','Legumes','Fruits','Condiments','Herbes','Herbes'];
const prices = [1500,800,600,1200,700,900,500,650,400,350,1000,800,450,1100,550,1300,300,2000,600,500];
const zones = ['Niayes','Thies','Casamance','Fatick','Dakar'];
const regions = ['Dakar','Thies','Ziguinchor','Fatick','Kaolack'];
const coops = ['Coop Niayes','Coop Thies','Coop Casamance','GIE Dakar','Coop Fatick'];
const methods = ['Wave','Orange Money','Free Money'];
const demoHash = 'd3ad9315b7be5dd53b31a273b3b3aba5defe700808305aa16a3062b76658a791';

const pad = (n, len) => String(n).padStart(len, '0');
const rand = (min, max) => min + Math.floor(Math.random() * (max - min));

const data = {
  users: names.map((name, i) => ({
    id: `usr-demo-${pad(i+1, 3)}`,
    createdAt: new Date(2026, 3, 1 + Math.floor(i/3)).toISOString(),
    name,
    email: `demo${i+1}@frescoop.sn`,
    phone: `+221 77 ${100+i} 00 00`,
    role: i < 35 ? 'agriculteur' : i < 40 ? 'client' : i < 45 ? 'acheteurB2B' : 'agentTerrain',
    status: 'Actif',
    organization: coops[i % 5],
    region: regions[i % 5],
    bio: 'Productrice demo FresCoop',
    gender: i < 30 ? 'F' : 'M',
    passwordHash: demoHash,
  })),

  products: Array.from({length: 200}, (_, i) => ({
    id: `prd-${pad(i+1, 4)}`,
    createdAt: new Date(2026, 3, 5 + Math.floor(i/10)).toISOString(),
    name: productNames[i % 20],
    category: categories[i % 20],
    quantity: rand(20, 100),
    unit: 'kg',
    price: prices[i % 20],
    zone: zones[i % 5],
    status: i % 4 === 0 ? 'Brouillon' : 'Publie',
    ownerId: `usr-demo-${pad((i % 35) + 1, 3)}`,
    image: '',
  })),

  lots: Array.from({length: 80}, (_, i) => ({
    id: `lot-${pad(i+1, 4)}`,
    createdAt: new Date(2026, 3, 10 + Math.floor(i/5)).toISOString(),
    productId: `prd-${pad((i % 200) + 1, 4)}`,
    ownerId: `usr-demo-${pad((i % 35) + 1, 3)}`,
    quantityKg: rand(50, 250),
    hubId: `hub-${pad((i % 8) + 1, 3)}`,
    status: ['Stocke','En transit','Livre','Vendu'][i % 4],
    temperature: +(4 + Math.random() * 3).toFixed(1),
    humidity: +(70 + Math.random() * 15).toFixed(1),
    qrCode: `FRES-LOT-${pad(i+1, 4)}`,
    expiryDate: new Date(2026, 4, 1 + Math.floor(i/3)).toISOString(),
    origin: zones[i % 5],
  })),

  hubs: [
    {id:'hub-001',name:'Hub Solaire Niayes',location:'Niayes',capacity:800,currentStock:320,temperature:3.5,solarPower:true,status:'Operationnel'},
    {id:'hub-002',name:'Hub Solaire Thies',location:'Thies',capacity:600,currentStock:210,temperature:4.1,solarPower:true,status:'Operationnel'},
    {id:'hub-003',name:'Hub Casamance',location:'Ziguinchor',capacity:500,currentStock:180,temperature:3.8,solarPower:true,status:'Operationnel'},
    {id:'hub-004',name:'Hub Fatick',location:'Fatick',capacity:400,currentStock:120,temperature:4.3,solarPower:true,status:'Operationnel'},
    {id:'hub-005',name:'Hub Kaolack',location:'Kaolack',capacity:450,currentStock:150,temperature:4.0,solarPower:true,status:'Operationnel'},
    {id:'hub-006',name:'Hub Dakar Nord',location:'Dakar',capacity:700,currentStock:280,temperature:3.2,solarPower:true,status:'Operationnel'},
    {id:'hub-007',name:'Hub Mbour',location:'Mbour',capacity:550,currentStock:200,temperature:3.9,solarPower:true,status:'Operationnel'},
    {id:'hub-008',name:'Hub Ziguinchor Sud',location:'Ziguinchor',capacity:500,currentStock:160,temperature:4.2,solarPower:true,status:'Operationnel'},
  ].map((h) => ({...h, createdAt: new Date(2026, 3, 1).toISOString(), managerId: `usr-demo-${pad(46 + parseInt(h.id.slice(-1)), 3)}`})),

  orders: Array.from({length: 120}, (_, i) => ({
    id: `ord-${pad(i+1, 4)}`,
    createdAt: new Date(2026, 3, 8 + Math.floor(i/6)).toISOString(),
    productId: `prd-${pad((i % 200) + 1, 4)}`,
    clientId: `usr-demo-${pad((i % 10) + 36, 3)}`,
    sellerId: `usr-demo-${pad((i % 35) + 1, 3)}`,
    quantity: rand(5, 35),
    status: ['Confirmee','Livree','Livree','En attente','Confirmee','Livree'][i % 6],
    paymentStatus: i % 3 === 0 ? 'Paye' : 'En attente',
    totalPrice: rand(5, 35) * prices[i % 5],
  })),

  transactions: Array.from({length: 90}, (_, i) => ({
    id: `txn-${pad(i+1, 4)}`,
    date: new Date(2026, 3, 10 + Math.floor(i/5)).toISOString(),
    label: `Vente ${productNames[i % 5]}`,
    amount: rand(5000, 50000),
    buyer: `Acheteur ${(i % 10) + 1}`,
    paymentMethod: methods[i % 3],
    status: 'Confirme',
    reference: `PAY-${1000 + i}`,
    ownerId: `usr-demo-${pad((i % 35) + 1, 3)}`,
  })),

  paymentRecords: Array.from({length: 45}, (_, i) => ({
    id: `pay-${pad(i+1, 4)}`,
    createdAt: new Date(2026, 3, 12 + Math.floor(i/3)).toISOString(),
    orderId: `ord-${pad((i * 3) + 1, 4)}`,
    amount: rand(8000, 48000),
    method: methods[i % 3],
    partner: 'paydunya',
    paydunyaToken: `pdtk_demo_${i+1}`,
    status: 'success',
    payerId: `usr-demo-${pad((i % 10) + 36, 3)}`,
    sellerId: `usr-demo-${pad((i % 35) + 1, 3)}`,
    receiptCode: `REC-${2000 + i}`,
  })),

  dossiers: Array.from({length: 25}, (_, i) => ({
    id: `dos-${pad(i+1, 4)}`,
    createdAt: new Date(2026, 3, 15 + Math.floor(i/3)).toISOString(),
    title: `Dossier ${productNames[i % 5]}`,
    type: 'bancabilite',
    status: ['valide','en_attente','valide','valide','en_attente'][i % 5],
    ownerId: `usr-demo-${pad((i % 35) + 1, 3)}`,
    personName: `${names[i % 5]} - Dossier credit`,
    personId: `CNI-${10000 + i}`,
    pieces: [{name: 'Attestation vente', type: 'pdf'}],
  })),

  proofs: Array.from({length: 20}, (_, i) => ({
    id: `prf-${pad(i+1, 4)}`,
    createdAt: new Date(2026, 3, 18 + Math.floor(i/3)).toISOString(),
    ownerId: `usr-demo-${pad((i % 35) + 1, 3)}`,
    type: 'economique',
    totalRevenue: rand(50000, 250000),
    transactionCount: rand(5, 25),
    period: '2026-Q1',
    score: rand(45, 85),
    status: 'emise',
  })),

  attestations: Array.from({length: 15}, (_, i) => ({
    id: `att-${pad(i+1, 4)}`,
    createdAt: new Date(2026, 3, 20 + Math.floor(i/3)).toISOString(),
    ownerId: `usr-demo-${pad((i % 35) + 1, 3)}`,
    title: 'Attestation de preuve economique',
    verificationCode: `FRES-ATT-${3000 + i}`,
    score: {total: rand(55, 90)},
    dossierSnapshot: {personName: names[i % 5]},
  })),
};

const outPath = join(__dirname, '..', 'server', 'seed-data.json');
writeFileSync(outPath, JSON.stringify(data, null, 2));
console.log(`seed-data.json: ${data.users.length} users, ${data.products.length} products, ${data.lots.length} lots, ${data.hubs.length} hubs, ${data.orders.length} orders, ${data.paymentRecords.length} paiements PayDunya`);
