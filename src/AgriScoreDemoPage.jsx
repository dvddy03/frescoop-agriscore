import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ArrowDown, ArrowLeft, ArrowRight, BadgeCheck, Boxes, Building2,
  CheckCircle2, ChevronLeft, ChevronRight, Clock, Download, FileCheck2, FileText,
  Landmark, Leaf, Maximize2, MapPin, Pause, Phone, PlayCircle, RefreshCcw,
  ScanLine, ShieldCheck, ShoppingBasket, Smartphone, Sparkles, Sprout, Target,
  TrendingUp, UserCheck, Users, X, XCircle,
} from 'lucide-react';
import {
  FARMERS, PROOFS, TIMELINE, IMPACT_METRICS,
  calculateAgriScore, boostedFarmer,
} from './data/agriscoreDemoData.js';
import './agriscore.css';

/* ========================================================================== */
/* Constantes                                                                  */
/* ========================================================================== */

/** Les 4 écrans du parcours démo. `hash` sert aux ancres /public/agriscore#... */
const SCREENS = [
  { hash: 'agriculteur', num: '1', label: 'Agriculteur' },
  { hash: 'preuves', num: '2', label: 'Preuves' },
  { hash: 'score', num: '3', label: 'Score' },
  { hash: 'dossier', num: '4', label: 'Dossier' },
];

const AUTO_ADVANCE_MS = 9000; // mode présentation : 9 s par écran

const KEY_PHRASE = 'Nous ne prêtons pas. Nous rendons les agriculteurs finançables.';

/* ========================================================================== */
/* Helpers                                                                     */
/* ========================================================================== */

const formatFcfa = (value) => `${new Intl.NumberFormat('fr-FR').format(Math.round(value))} FCFA`;

const SOURCE_ICON = {
  marketplace: ShoppingBasket,
  paiement: Smartphone,
  agent: UserCheck,
  cooperative: Users,
  lot: Boxes,
  document: FileText,
};

const SOURCE_LABEL = {
  marketplace: 'Marketplace',
  paiement: 'Paiement',
  agent: 'Agent terrain',
  cooperative: 'Coopérative',
  lot: 'Lot tracé',
  document: 'Document',
};

function StatusBadge({ status }) {
  if (status === 'Vérifié') {
    return <span className="ags-badge ags-badge-ok"><CheckCircle2 size={13} /> Vérifié</span>;
  }
  if (status === 'Refusé') {
    return <span className="ags-badge ags-badge-no"><XCircle size={13} /> Refusé</span>;
  }
  return <span className="ags-badge ags-badge-wait"><Clock size={13} /> En attente</span>;
}

/* QR code simulé — motif déterministe généré depuis le code de vérification. */
function VerificationQRCode({ value }) {
  const grid = useMemo(() => {
    const N = 25;
    let h = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const rand = () => {
      h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
      return ((h >>> 0) % 1000) / 1000;
    };
    const cells = Array.from({ length: N }, () => Array.from({ length: N }, () => rand() > 0.52));
    const finder = (r0, c0) => {
      for (let r = 0; r < 7; r += 1) {
        for (let c = 0; c < 7; c += 1) {
          const edge = r === 0 || r === 6 || c === 0 || c === 6;
          const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          cells[r0 + r][c0 + c] = edge || core;
        }
      }
      for (let k = -1; k <= 7; k += 1) {
        if (cells[r0 + k] && cells[r0 + k][c0 - 1] !== undefined && r0 + k >= 0) cells[r0 + k][c0 - 1] = false;
        if (cells[r0 + k] && cells[r0 + k][c0 + 7] !== undefined) cells[r0 + k][c0 + 7] = false;
        if (cells[r0 - 1] && c0 + k >= 0 && c0 + k < N) cells[r0 - 1][c0 + k] = false;
        if (cells[r0 + 7] && c0 + k >= 0 && c0 + k < N) cells[r0 + 7][c0 + k] = false;
      }
    };
    finder(0, 0);
    finder(0, N - 7);
    finder(N - 7, 0);
    return cells;
  }, [value]);

  const N = grid.length;
  return (
    <div className="ags-qr" aria-label={`QR code de vérification ${value}`}>
      <svg viewBox={`0 0 ${N} ${N}`} role="img">
        {grid.map((row, r) => row.map((on, c) => (
          on ? <rect key={`${r}-${c}`} x={c} y={r} width="1.04" height="1.04" fill="#0a4b3e" /> : null
        )))}
      </svg>
    </div>
  );
}

/* Jauge circulaire animée. */
function ScoreGauge({ score }) {
  const [shown, setShown] = useState(0);
  const radius = 84;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (shown / 100) * circumference;

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setShown(score));
    return () => window.cancelAnimationFrame(id);
  }, [score]);

  return (
    <div className="ags-gauge">
      <svg viewBox="0 0 200 200">
        <circle className="ags-gauge-track" cx="100" cy="100" r={radius} fill="none" strokeWidth="16" />
        <circle
          className="ags-gauge-fill"
          cx="100" cy="100" r={radius} fill="none" strokeWidth="16"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="ags-gauge-center">
        <div>
          <div className="ags-gauge-num">{Math.round(shown)}<small>/100</small></div>
          <div className="ags-gauge-lbl">Score bancabilité</div>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Page                                                                        */
/* ========================================================================== */

export default function AgriScoreDemoPage({ navigate, route }) {
  const [farmerId, setFarmerId] = useState(FARMERS[0].id);
  const [simulated, setSimulated] = useState(false);
  const [decision, setDecision] = useState(null);
  const [view, setView] = useState('scroll'); // 'scroll' = page libre · 'step' = DemoRunner
  const [step, setStep] = useState(0);         // écran courant en mode 'step'
  const [playing, setPlaying] = useState(false); // auto-défilement (mode présentation)
  const [stage, setStage] = useState(false);     // plein écran présentation
  const [activeScroll, setActiveScroll] = useState('agriculteur');
  const rootRef = useRef(null);

  const farmer = useMemo(() => FARMERS.find((f) => f.id === farmerId), [farmerId]);
  const proofs = PROOFS[farmerId] || [];
  const timeline = TIMELINE[farmerId] || [];

  const baseScore = useMemo(() => calculateAgriScore(farmer, proofs), [farmer, proofs]);
  const boostScore = useMemo(
    () => calculateAgriScore(boostedFarmer(farmer), proofs),
    [farmer, proofs],
  );
  const score = simulated ? boostScore : baseScore;
  const verified = proofs.filter((p) => p.status === 'Vérifié').length;
  const isAwa = farmerId === 'awa-diop';

  /* ---- Réinitialise l'état au changement d'agriculteur ---- */
  useEffect(() => {
    setSimulated(false);
    setDecision(null);
  }, [farmerId]);

  /* ---- Ancre d'URL au chargement : /public/agriscore#preuves, #score… ---- */
  useEffect(() => {
    const hash = String(window.location.hash || '').replace('#', '').trim();
    const idx = SCREENS.findIndex((s) => s.hash === hash);
    if (idx >= 0) {
      setActiveScroll(SCREENS[idx].hash);
      window.setTimeout(() => {
        const el = document.getElementById(`screen-${SCREENS[idx].hash}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 220);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- Suivi de la section visible (mode scroll) ---- */
  useEffect(() => {
    if (view !== 'scroll') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveScroll(entry.target.id.replace('screen-', ''));
          }
        });
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    SCREENS.forEach((s) => {
      const el = document.getElementById(`screen-${s.hash}`);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [view]);

  /* ---- Auto-défilement du mode présentation ---- */
  useEffect(() => {
    if (!playing || view !== 'step') return undefined;
    if (step >= SCREENS.length - 1) {
      const stop = window.setTimeout(() => setPlaying(false), AUTO_ADVANCE_MS);
      return () => window.clearTimeout(stop);
    }
    const id = window.setTimeout(
      () => setStep((s) => Math.min(s + 1, SCREENS.length - 1)),
      AUTO_ADVANCE_MS,
    );
    return () => window.clearTimeout(id);
  }, [playing, view, step]);

  /* ---- Sortie de plein écran via Échap : on resynchronise l'état ---- */
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) {
        setStage(false);
        setPlaying(false);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  /* ---- Navigation entre écrans (scroll ou step selon le mode) ---- */
  const goToScreen = useCallback((index) => {
    const target = SCREENS[Math.max(0, Math.min(index, SCREENS.length - 1))];
    if (view === 'step') {
      setStep(SCREENS.indexOf(target));
    } else {
      const el = document.getElementById(`screen-${target.hash}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setActiveScroll(target.hash);
    window.history.replaceState(null, '', `#${target.hash}`);
  }, [view]);

  /* ---- Lancer le parcours pas-à-pas (DemoRunner) ---- */
  const startRunner = () => {
    setView('step');
    setStep(0);
    setPlaying(false);
    window.history.replaceState(null, '', `#${SCREENS[0].hash}`);
  };

  /* ---- Quitter le mode pas-à-pas ---- */
  const exitRunner = () => {
    setView('scroll');
    setPlaying(false);
    setStage(false);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  };

  /* ---- Mode présentation : plein écran + auto-défilement ---- */
  const startPresentation = () => {
    setView('step');
    setStep(0);
    setPlaying(true);
    setStage(true);
    const node = rootRef.current;
    if (node?.requestFullscreen && !document.fullscreenElement) {
      node.requestFullscreen().catch(() => {});
    }
  };

  const selectFarmer = (id) => {
    setFarmerId(id);
    if (view === 'step') setStep(0);
  };

  /* ======================================================================== */
  /* Rendu des 4 écrans                                                        */
  /* ======================================================================== */

  const screenFarmer = (
    <section className="ags-section" id="screen-agriculteur">
      <div className="ags-section-head">
        <span className="ags-eyebrow"><Leaf size={13} /> Écran 1</span>
        <h2>Un agriculteur invisible pour la banque</h2>
        <p>
          {farmer.name} a une activité agricole réelle. Le problème n’est pas l’activité —
          c’est l’absence de preuves consolidées.
        </p>
      </div>

      <div className="ags-card">
        <div className="ags-profile">
          <div className="ags-avatar">{farmer.initials}</div>
          <div className="ags-profile-main">
            <h3>{farmer.name}</h3>
            <div className="ags-profile-meta">
              <span><MapPin size={14} /> {farmer.region}</span>
              <span><Sprout size={14} /> {farmer.filiere}</span>
              <span><Users size={14} /> {farmer.cooperative}</span>
              <span><Phone size={14} /> {farmer.phone}</span>
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="ags-badge ags-badge-no">Statut initial : non bancable</span>
              <span className="ags-badge ags-badge-info"><Target size={12} /> {farmer.objective}</span>
            </div>
            <div className="ags-profile-quote">
              {isAwa
                ? '« Awa vend régulièrement ses récoltes, mais aucune banque ne peut le prouver. FresCoop transforme son activité réelle en dossier de crédit vérifiable. »'
                : `${farmer.name} a une activité agricole réelle, mais ses preuves restent incomplètes. FresCoop montre précisément ce qu’il reste à consolider.`}
            </div>
          </div>
        </div>

        <div className="ags-grid-2" style={{ marginTop: 20 }}>
          <div className="ags-ba-card ags-ba-before">
            <h4><XCircle size={18} color="#e54d35" /> Avant FresCoop</h4>
            <ul className="ags-ba-list">
              {['Ventes informelles, non enregistrées',
                'Paiements dispersés et invérifiables',
                'Aucune preuve consolidée',
                'Accès au crédit refusé'].map((item) => (
                <li key={item}><XCircle size={15} color="#e54d35" /> {item}</li>
              ))}
            </ul>
          </div>
          <div className="ags-ba-card ags-ba-after">
            <h4><CheckCircle2 size={18} color="#1f835d" /> Avec FresCoop</h4>
            <ul className="ags-ba-list">
              {['Ventes enregistrées et confirmées',
                'Paiements mobiles vérifiés',
                'Lots tracés avec QR code',
                'Attestation coopérative validée',
                'Score de bancabilité transparent'].map((item) => (
                <li key={item}><CheckCircle2 size={15} color="#1f835d" /> {item}</li>
              ))}
            </ul>
          </div>
        </div>
        {view === 'scroll' && (
          <div style={{ textAlign: 'center', marginTop: 18 }}>
            <button className="ags-btn ags-btn-green" type="button" onClick={() => goToScreen(1)}>
              Voir ses preuves économiques <ArrowDown size={16} />
            </button>
          </div>
        )}
      </div>
    </section>
  );

  const screenProofs = (
    <section className="ags-section" id="screen-preuves">
      <div className="ags-section-head">
        <span className="ags-eyebrow"><FileCheck2 size={13} /> Écran 2</span>
        <h2>Chaque vente devient une preuve</h2>
        <p>
          {verified} preuves vérifiées alimentent automatiquement le dossier de {farmer.name}.
          Chaque paiement renforce la confiance ; chaque lot tracé construit un historique économique.
        </p>
      </div>

      <div className="ags-grid-2" style={{ alignItems: 'start' }}>
        <div className="ags-card">
          <h3 style={{ fontSize: '1.02rem', marginBottom: 14 }}>Preuves collectées</h3>
          <div className="ags-proof-grid">
            {proofs.map((proof) => {
              const Icon = SOURCE_ICON[proof.source] || FileText;
              return (
                <article key={proof.id} className="ags-proof">
                  <div className={`ags-proof-icon s-${proof.source}`}><Icon size={20} /></div>
                  <div className="ags-proof-body">
                    <h4>{proof.title}</h4>
                    <div className="ags-proof-detail">{proof.detail}</div>
                    <div className="ags-proof-foot">
                      <StatusBadge status={proof.status} />
                      <span>· {SOURCE_LABEL[proof.source]}</span>
                      <span>· {proof.date}</span>
                    </div>
                    <div className="ags-proof-foot" style={{ marginTop: 4 }}>
                      <span style={{ fontWeight: 700, color: '#1f835d' }}>{proof.impact}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <div>
          <div className="ags-card">
            <h3 style={{ fontSize: '1.02rem', marginBottom: 14 }}>Historique économique</h3>
            <div className="ags-timeline">
              {timeline.map((item) => (
                <div key={item.date + item.label} className={`ags-tl-item${item.source === 'score' ? ' is-score' : ''}`}>
                  <span className="ags-tl-dot" />
                  <div className="ags-tl-date">{item.date}</div>
                  <div className="ags-tl-label">{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Pédagogie : comment une preuve devient un point de score */}
          <div className="ags-card ags-pedago" style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: '1.02rem' }}><Sparkles size={17} color="#d99912" /> Comment une preuve devient un point</h3>
            <ul className="ags-pedago-list">
              <li><ShoppingBasket size={15} /> Une <strong>vente confirmée</strong> alimente le critère « Transactions vérifiées ».</li>
              <li><Smartphone size={15} /> Un <strong>paiement mobile vérifié</strong> alimente « Paiements mobiles confirmés ».</li>
              <li><TrendingUp size={15} /> Des ventes <strong>étalées dans le temps</strong> renforcent la « Régularité des ventes ».</li>
              <li><Users size={15} /> Une <strong>attestation coopérative</strong> et une <strong>visite d’agent</strong> valent 10 points chacune.</li>
              <li><Boxes size={15} /> Un <strong>lot tracé</strong> (QR + capteurs) construit l’historique « Lots tracés ».</li>
            </ul>
            <p className="ags-pedago-note">
              7 critères, 100 points : une activité réelle et vérifiée devient un score lisible par une banque.
            </p>
          </div>

          {view === 'scroll' && (
            <button
              className="ags-btn ags-btn-green ags-btn-block"
              type="button"
              style={{ marginTop: 14 }}
              onClick={() => goToScreen(2)}
            >
              Calculer le score de bancabilité <ArrowRight size={16} />
            </button>
          )}
        </div>
      </div>
    </section>
  );

  const screenScore = (
    <section className="ags-section" id="screen-score">
      <div className="ags-section-head">
        <span className="ags-eyebrow"><TrendingUp size={13} /> Écran 3</span>
        <h2>Un score de bancabilité transparent</h2>
        <p>Sept critères pondérés, 100 points, une logique explicable. Aucun modèle opaque.</p>
      </div>

      <div className="ags-score-layout">
        <div className="ags-score-card">
          <ScoreGauge score={score.totalScore} />
          <div className="ags-grade-pill">
            <span className="ags-grade-letter">{score.grade}</span>
            Grade {score.grade} · {score.gradeLabel}
          </div>
          <div className="ags-score-facts">
            <div className="ags-score-fact"><span>Statut</span><span>{score.status}</span></div>
            <div className="ags-score-fact"><span>Montant recommandé</span><span>{score.recommendedAmount ? formatFcfa(score.recommendedAmount) : '—'}</span></div>
            <div className="ags-score-fact"><span>Durée recommandée</span><span>{score.recommendedDurationMonths} mois</span></div>
            <div className="ags-score-fact"><span>Remboursement</span><span>Après récolte</span></div>
            <div className="ags-score-fact"><span>Risque estimé</span><span>{score.risk}</span></div>
            <div className="ags-score-fact"><span>Confiance des données</span><span>{score.dataConfidence}</span></div>
          </div>
        </div>

        <div className="ags-card">
          <h3 style={{ fontSize: '1.02rem' }}>Détail du calcul — {score.totalScore}/100</h3>
          <div style={{ marginTop: 8 }}>
            {score.breakdown.map((item) => (
              <div key={item.key} className="ags-breakdown-row">
                <div className="ags-breakdown-top">
                  <div>
                    <strong>{item.label}</strong>
                    <div className="ags-breakdown-hint">{item.hint}</div>
                  </div>
                  <span className="ags-breakdown-val">{item.value} / {item.max}</span>
                </div>
                <div className="ags-bar">
                  <div
                    className={`ags-bar-fill${item.pct < 70 ? ' is-low' : ''}`}
                    style={{ width: `${item.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="ags-explain">
            Ce score ne remplace pas la décision bancaire. Il rend le dossier lisible,
            vérifiable et comparable pour une banque ou un SFD.
          </div>

          {score.missingActions.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <strong style={{ fontSize: '0.9rem' }}>Pour progresser, {farmer.name} doit :</strong>
              <ul className="ags-value-list" style={{ marginTop: 8 }}>
                {score.missingActions.map((action) => (
                  <li key={action.label}>
                    <Target size={15} />
                    <span>{action.advice} <em style={{ color: '#5a6b63' }}>(+{action.gain} pts possibles)</em></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Simulateur WOW */}
      <div className="ags-sim">
        <h4><Sparkles size={18} color="#d99912" /> Simulateur · « Et si {farmer.name.split(' ')[0]} vend 3 fois plus ce mois-ci ? »</h4>
        <p style={{ color: '#5a6b63', fontSize: '0.88rem', marginTop: 4 }}>
          Plus l’activité est enregistrée, plus le producteur devient finançable.
        </p>
        <div className="ags-sim-compare">
          <div className="ags-sim-num now">
            <b>{baseScore.totalScore}</b>
            <span>Score actuel</span>
          </div>
          <ArrowRight className="ags-sim-arrow" size={30} />
          <div className="ags-sim-num next">
            <b>{simulated ? boostScore.totalScore : '?'}</b>
            <span>Score simulé</span>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            {simulated ? (
              <div className="ags-sim-msg">
                Montant recommandé : {formatFcfa(baseScore.recommendedAmount)} →{' '}
                <strong style={{ color: '#1f835d' }}>{formatFcfa(boostScore.recommendedAmount)}</strong>
                {boostScore.grade !== baseScore.grade && (
                  <> · {farmer.name.split(' ')[0]} passe du grade {baseScore.grade} au grade {boostScore.grade}.</>
                )}
              </div>
            ) : (
              <div className="ags-sim-msg" style={{ color: '#5a6b63' }}>
                Lancez la simulation pour voir l’effet d’une activité enregistrée plus régulière.
              </div>
            )}
          </div>
        </div>
        <button
          className={`ags-btn ${simulated ? 'ags-btn-outline' : 'ags-btn-primary'}`}
          type="button"
          onClick={() => setSimulated((v) => !v)}
        >
          {simulated ? <><RefreshCcw size={16} /> Revenir au score actuel</> : <><Sparkles size={16} /> Simuler 3× plus de ventes</>}
        </button>
      </div>

      {view === 'scroll' && (
        <div style={{ textAlign: 'center', marginTop: 18 }}>
          <button className="ags-btn ags-btn-green" type="button" onClick={() => goToScreen(3)}>
            Ouvrir le dossier côté banque <ArrowDown size={16} />
          </button>
        </div>
      )}
    </section>
  );

  const screenDossier = (
    <section className="ags-section" id="screen-dossier">
      <div className="ags-section-head">
        <span className="ags-eyebrow"><Landmark size={13} /> Écran 4 · Vue partenaire finance</span>
        <h2>Dossier de crédit vérifiable — {farmer.name}</h2>
        <p>Un dossier bancaire prêt à être vérifié par une banque ou un SFD.</p>
      </div>

      <div className="ags-card">
        <div className="ags-dossier-head">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="ags-avatar" style={{ width: 56, height: 56, fontSize: '1.2rem' }}>{farmer.initials}</div>
              <div>
                <h3 style={{ fontSize: '1.2rem' }}>{farmer.name}</h3>
                <div style={{ color: '#5a6b63', fontSize: '0.86rem' }}>{farmer.filiere} · {farmer.region}</div>
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '2.4rem', fontWeight: 800, lineHeight: 1, color: '#0a4b3e' }}>
              {baseScore.totalScore}<span style={{ fontSize: '1rem', color: '#5a6b63' }}>/100</span>
            </div>
            <span className="ags-badge ags-badge-dark" style={{ marginTop: 6 }}>
              Grade {baseScore.grade} · {baseScore.status}
            </span>
          </div>
        </div>

        <div className="ags-dossier-grid">
          <div className="ags-field"><span>Coopérative</span><span>{farmer.cooperative}</span></div>
          <div className="ags-field"><span>Agent terrain</span><span>{farmer.fieldAgent}</span></div>
          <div className="ags-field"><span>Téléphone</span><span>{farmer.phone}</span></div>
          <div className="ags-field"><span>Preuves vérifiées</span><span>{verified} / {proofs.length}</span></div>
          <div className="ags-field"><span>Montant demandé</span><span>{formatFcfa(farmer.requestedAmount)}</span></div>
          <div className="ags-field"><span>Montant recommandé</span><span>{baseScore.recommendedAmount ? formatFcfa(baseScore.recommendedAmount) : 'Non recommandé'}</span></div>
          <div className="ags-field"><span>Durée recommandée</span><span>{baseScore.recommendedDurationMonths} mois · après récolte</span></div>
          <div className="ags-field"><span>Risque estimé</span><span>{baseScore.risk}</span></div>
          <div className="ags-field"><span>Consentement producteur</span><span>{farmer.consentGranted ? `Accordé le ${farmer.consentDate}` : 'Non accordé'}</span></div>
          <div className="ags-field"><span>Fraîcheur des données</span><span>{farmer.dataFreshness}</span></div>
        </div>

        <div className="ags-qr-box" style={{ marginTop: 18 }}>
          <VerificationQRCode value={farmer.verificationCode} />
          <div>
            <div style={{ fontSize: '0.78rem', color: '#5a6b63', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
              Code de vérification
            </div>
            <div className="ags-qr-code">{farmer.verificationCode}</div>
            <div style={{ fontSize: '0.82rem', color: '#5a6b63', marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <ScanLine size={14} /> Code vérifiable par banque / SFD
            </div>
          </div>
        </div>

        <div className="ags-decision">
          <button className="ags-btn ags-btn-green" type="button" onClick={() => setDecision('approved')}>
            <CheckCircle2 size={17} /> Pré-approuver
          </button>
          <button className="ags-btn ags-btn-outline" type="button" onClick={() => setDecision('complement')}>
            <AlertCircle size={17} /> Demander un complément
          </button>
          <button className="ags-btn ags-btn-coral" type="button" onClick={() => setDecision('rejected')}>
            <XCircle size={17} /> Refuser
          </button>
        </div>

        {decision === 'approved' && (
          <div className="ags-result ok">
            <BadgeCheck size={22} color="#1f835d" />
            <div>
              <h4>Pré-approbation envoyée à {farmer.name}</h4>
              <p>
                {baseScore.recommendedAmount ? formatFcfa(baseScore.recommendedAmount) : 'Montant à définir'}
                {' '}· échéance après récolte ({baseScore.recommendedDurationMonths} mois).
              </p>
            </div>
          </div>
        )}
        {decision === 'complement' && (
          <div className="ags-result wait">
            <Clock size={22} color="#8a5e00" />
            <div>
              <h4>Complément demandé à {farmer.name}</h4>
              <p>
                Le producteur est invité à renforcer son dossier
                {score.missingActions[0] ? ` : ${score.missingActions[0].advice.toLowerCase()}` : '.'}
              </p>
            </div>
          </div>
        )}
        {decision === 'rejected' && (
          <div className="ags-result no">
            <XCircle size={22} color="#a32a17" />
            <div>
              <h4>Demande non retenue pour le moment</h4>
              <p>Le dossier reste accessible : {farmer.name} pourra le représenter après consolidation des preuves.</p>
            </div>
          </div>
        )}

        <div className="ags-final-note">
          <ShieldCheck size={15} /> Décision finale réservée à la banque / au SFD. {KEY_PHRASE}
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="ags-btn ags-btn-outline" type="button" onClick={() => window.print()}>
            <Download size={16} /> Télécharger le dossier (PDF)
          </button>
        </div>
      </div>
    </section>
  );

  const SCREEN_NODES = [screenFarmer, screenProofs, screenScore, screenDossier];

  /* ======================================================================== */
  /* Sélecteur d'agriculteur                                                   */
  /* ======================================================================== */

  const farmerSwitch = (
    <div className="ags-farmer-switch">
      {FARMERS.map((f) => {
        const s = calculateAgriScore(f, PROOFS[f.id]);
        const color = s.grade === 'A' || s.grade === 'B' ? '#1f835d'
          : s.grade === 'C' ? '#d99912' : '#e54d35';
        return (
          <button
            key={f.id}
            type="button"
            className={`ags-farmer-chip${farmerId === f.id ? ' is-active' : ''}`}
            onClick={() => selectFarmer(f.id)}
          >
            <span className="ags-chip-avatar" style={{ background: color }}>{f.initials}</span>
            <span>
              <span className="ags-chip-name">{f.name}</span>
              <span className="ags-chip-score">Score {s.totalScore} · Grade {s.grade}</span>
            </span>
          </button>
        );
      })}
    </div>
  );

  /* ======================================================================== */
  /* MODE PAS-À-PAS (DemoRunner)                                               */
  /* ======================================================================== */

  if (view === 'step') {
    return (
      <div ref={rootRef} className={`ags-root ags-runner${stage ? ' is-stage' : ''}`}>
        {!stage && (
          <nav className="ags-nav">
            <div className="ags-nav-inner">
              <button className="ags-brand" type="button" onClick={exitRunner}>
                <span className="ags-brand-mark"><Sprout size={19} /></span>
                <span>AgriScore<small>by FresCoop</small></span>
              </button>
              <button className="ags-btn ags-btn-outline" type="button" style={{ marginLeft: 'auto' }} onClick={exitRunner}>
                <X size={16} /> Quitter le mode démo
              </button>
            </div>
          </nav>
        )}

        <div className="ags-shell" id="ags-top">
          {/* En-tête compact du runner */}
          <div className="ags-runner-head">
            <div>
              <span className="ags-eyebrow"><PlayCircle size={13} /> Démo jury · écran {step + 1} / {SCREENS.length}</span>
              <p className="ags-runner-phrase">« {KEY_PHRASE} »</p>
            </div>
            {stage && (
              <button className="ags-btn ags-btn-outline" type="button" onClick={exitRunner}>
                <X size={16} /> Quitter
              </button>
            )}
          </div>

          {/* Fil d'étapes cliquable */}
          <div className="ags-stepbar">
            {SCREENS.map((s, i) => (
              <button
                key={s.hash}
                type="button"
                className={`ags-stepbar-item${i === step ? ' is-active' : ''}${i < step ? ' is-done' : ''}`}
                onClick={() => goToScreen(i)}
              >
                <span className="ags-stepbar-num">{i < step ? <CheckCircle2 size={15} /> : s.num}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </div>

          {farmerSwitch}

          {/* Écran courant */}
          <div className="ags-runner-screen" key={`${farmerId}-${step}`}>
            {SCREEN_NODES[step]}
          </div>
        </div>

        {/* Barre de contrôle fixe */}
        <div className="ags-runner-bar">
          <button
            className="ags-btn ags-btn-outline"
            type="button"
            disabled={step === 0}
            onClick={() => goToScreen(step - 1)}
          >
            <ChevronLeft size={17} /> Précédent
          </button>

          <div className="ags-runner-dots">
            {SCREENS.map((s, i) => (
              <button
                key={s.hash}
                type="button"
                aria-label={s.label}
                className={`ags-dot${i === step ? ' is-active' : ''}`}
                onClick={() => goToScreen(i)}
              />
            ))}
            <button
              className="ags-btn ags-btn-ghost-dark ags-runner-play"
              type="button"
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? <><Pause size={15} /> Pause</> : <><PlayCircle size={15} /> Lecture auto</>}
            </button>
          </div>

          {step < SCREENS.length - 1 ? (
            <button className="ags-btn ags-btn-primary" type="button" onClick={() => goToScreen(step + 1)}>
              Suivant <ChevronRight size={17} />
            </button>
          ) : (
            <button className="ags-btn ags-btn-green" type="button" onClick={exitRunner}>
              <CheckCircle2 size={17} /> Terminer la démo
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ======================================================================== */
  /* MODE LIBRE (page complète défilante)                                      */
  /* ======================================================================== */

  return (
    <div ref={rootRef} className="ags-root">
      <nav className="ags-nav">
        <div className="ags-nav-inner">
          <button className="ags-brand" type="button" onClick={() => (navigate ? navigate('/') : null)}>
            <span className="ags-brand-mark"><Sprout size={19} /></span>
            <span>AgriScore<small>by FresCoop</small></span>
          </button>
          <div className="ags-nav-steps">
            {SCREENS.map((s, i) => (
              <button
                key={s.hash}
                type="button"
                className={`ags-nav-step${activeScroll === s.hash ? ' is-active' : ''}`}
                onClick={() => goToScreen(i)}
              >
                {s.num} · {s.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <div className="ags-shell" id="ags-top">
        {/* Hero */}
        <header className="ags-hero">
          <span className="ags-hero-tag"><Sparkles size={14} /> Démo hackathon · GIM-UEMOA 2026</span>
          <h1>L’agriculteur invisible devient un dossier de crédit vérifiable.</h1>
          <p>
            FresCoop transforme les preuves du terrain — ventes, paiements, lots tracés,
            attestations — en langage bancaire. Un score 0–100, un dossier vérifiable,
            une décision en moins de 5 minutes.
          </p>
          <div className="ags-hero-quote">« {KEY_PHRASE} »</div>
          <div className="ags-hero-actions">
            <button className="ags-btn ags-btn-primary" type="button" onClick={startRunner}>
              <PlayCircle size={18} /> Lancer la démo jury
            </button>
            <button className="ags-btn ags-btn-ghost" type="button" onClick={startPresentation}>
              <Maximize2 size={17} /> Mode présentation
            </button>
            {navigate && (
              <button className="ags-btn ags-btn-ghost" type="button" onClick={() => navigate('/')}>
                Retour à la plateforme
              </button>
            )}
          </div>
        </header>

        <div className="ags-section" style={{ marginTop: 32 }}>
          <span className="ags-eyebrow"><Users size={13} /> Portefeuille de démonstration</span>
          <p style={{ color: '#5a6b63', fontSize: '0.88rem', margin: '6px 0 10px' }}>
            Cliquez un profil pour charger son détail. Ou lancez la démo jury guidée, écran par écran.
          </p>
          {farmerSwitch}
        </div>

        {/* Les 4 écrans */}
        {SCREEN_NODES.map((node, i) => (
          <React.Fragment key={SCREENS[i].hash}>{node}</React.Fragment>
        ))}

        {/* Bandeau impact */}
        <section className="ags-section">
          <div className="ags-impact-strip">
            {IMPACT_METRICS.map((metric) => (
              <div key={metric.label} className="ags-impact-item">
                <b>{metric.value}</b>
                <strong>{metric.label}</strong>
                <span>{metric.sub}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Pourquoi ça change tout */}
        <section className="ags-section">
          <div className="ags-card ags-why">
            <span className="ags-eyebrow"><Sparkles size={13} /> Pourquoi ça change tout ?</span>
            <p style={{ marginTop: 10, fontSize: '1.05rem', lineHeight: 1.55, maxWidth: '70ch' }}>
              Avant FresCoop, la banque voit un agriculteur sans historique. Après FresCoop,
              elle voit un dossier structuré : ventes, paiements, lots, attestations, agent
              terrain et revenu moyen.
            </p>
          </div>
        </section>

        {/* Valeur pour chaque acteur */}
        <section className="ags-section">
          <div className="ags-grid-3">
            <div className="ags-value-card">
              <h4><Building2 size={19} color="#1f835d" /> Pour la banque / SFD</h4>
              <ul className="ags-value-list">
                {['Réduit le coût d’instruction',
                  'Améliore la qualité des dossiers',
                  'Donne accès à un nouveau portefeuille rural',
                  'Garde la décision finale à l’institution',
                  'Fournit des preuves vérifiables'].map((item) => (
                  <li key={item}><CheckCircle2 size={15} /> {item}</li>
                ))}
              </ul>
            </div>
            <div className="ags-value-card">
              <h4><Sprout size={19} color="#1f835d" /> Pour l’agriculteur</h4>
              <ul className="ags-value-list">
                {['Devient visible pour les financeurs',
                  'Comprend ce qui améliore son score',
                  'Demande un crédit adapté à son cycle agricole',
                  'N’a pas besoin d’historique bancaire classique'].map((item) => (
                  <li key={item}><CheckCircle2 size={15} /> {item}</li>
                ))}
              </ul>
            </div>
            <div className="ags-value-card">
              <h4><Landmark size={19} color="#1f835d" /> Pour l’UEMOA</h4>
              <ul className="ags-value-list">
                {['Inclusion financière rurale',
                  'Formalisation progressive de l’activité agricole',
                  'Soutien aux productrices',
                  'Meilleure traçabilité des flux agricoles',
                  'Données d’impact exploitables'].map((item) => (
                  <li key={item}><CheckCircle2 size={15} /> {item}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <footer className="ags-foot">
          <p>
            <strong>AgriScore by FresCoop</strong> — Filières Agricoles UEMOA 2026.
            <br />
            FresCoop transforme les preuves du terrain en langage bancaire.
            Les banques gardent la décision finale.
          </p>
          <div style={{ marginTop: 14, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="ags-btn ags-btn-primary" type="button" onClick={startRunner}>
              <PlayCircle size={16} /> Lancer la démo jury
            </button>
            {navigate && (
              <button className="ags-btn ags-btn-outline" type="button" onClick={() => navigate('/')}>
                <ArrowLeft size={16} /> Retour à la plateforme
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
