'use strict';
// Formules métier. Fonctions pures, sans accès à la base, testées unitairement.

const NATURES = ['main_oeuvre', 'materiau', 'materiel', 'sous_traitance'];
const PRESENCES_TRAVAILLEES = new Set(['present', 'demi_journee']);

const round = (x, d = 0) => {
  const f = 10 ** d;
  return Math.round((x + Number.EPSILON) * f) / f;
};

// ---------- Pointage ----------

// Coût main-d'œuvre d'une ligne de pointage :
//   coût = taux × (heures normales + heures sup × (1 + majoration %))
function coutPointage({ presence, heures_normales, heures_sup, taux_horaire, majoration_hs_pct }) {
  if (!PRESENCES_TRAVAILLEES.has(presence)) return 0;
  const hn = Number(heures_normales) || 0;
  const hs = Number(heures_sup) || 0;
  return taux_horaire * (hn + hs * (1 + majoration_hs_pct / 100));
}

// Valeurs d'heures par défaut selon la présence : une absence ne génère aucune heure sur le chantier.
function normaliserHeures(presence, hn, hs, heuresStandard) {
  if (!PRESENCES_TRAVAILLEES.has(presence)) return { heures_normales: 0, heures_sup: 0 };
  if (hn === undefined || hn === null || hn === '') {
    hn = presence === 'demi_journee' ? heuresStandard / 2 : heuresStandard;
  }
  return { heures_normales: Number(hn), heures_sup: Number(hs) || 0 };
}

// ---------- Déboursé sec ----------

// Déboursé sec unitaire d'un ouvrage, décomposé par nature de ressource.
//   DS unitaire = Σ (quantité × (1 + pertes %) × prix unitaire) / quantité de base
function deboursSecOuvrage(quantiteBase, composants) {
  const ds = { main_oeuvre: 0, materiau: 0, materiel: 0, sous_traitance: 0 };
  for (const c of composants) {
    const montant = c.quantite * (1 + (c.pertes_pct || 0) / 100) * c.prix_unitaire;
    ds[c.type] += montant / quantiteBase;
  }
  ds.total = NATURES.reduce((s, n) => s + ds[n], 0);
  return ds;
}

// Coefficient de vente K appliqué au déboursé sec :
//   K = (1 + frais de chantier) × (1 + frais généraux) × (1 + aléas) × (1 + bénéfice)
function coefficientK(e) {
  return (1 + e.frais_chantier_pct / 100) * (1 + e.frais_generaux_pct / 100)
       * (1 + e.aleas_pct / 100) * (1 + e.benefice_pct / 100);
}

function dsUnitaireLigne(l) {
  return l.ds_main_oeuvre + l.ds_materiau + l.ds_materiel + l.ds_sous_traitance;
}

// Calcul complet d'une étude.
// Le prix de vente unitaire est arrondi au franc CFA (usage BPU), le montant
// de la ligne est quantité × PU arrondi, et le total HT est la somme des lignes.
function calculerEtude(etude, lignes) {
  const K = coefficientK(etude);
  const parNature = { main_oeuvre: 0, materiau: 0, materiel: 0, sous_traitance: 0 };
  let dsTotal = 0;
  let totalHT = 0;
  const lignesCalc = lignes.map((l) => {
    const dsU = dsUnitaireLigne(l);
    const dsLigne = dsU * l.quantite;
    parNature.main_oeuvre += l.ds_main_oeuvre * l.quantite;
    parNature.materiau += l.ds_materiau * l.quantite;
    parNature.materiel += l.ds_materiel * l.quantite;
    parNature.sous_traitance += l.ds_sous_traitance * l.quantite;
    dsTotal += dsLigne;
    const puVente = round(dsU * K);
    const montant = round(puVente * l.quantite);
    totalHT += montant;
    return { ...l, ds_unitaire: round(dsU, 2), ds_total: round(dsLigne), pu_vente: puVente, montant_ht: montant };
  });

  // Décomposition théorique (cascade) du passage DS -> prix de vente
  const fc = dsTotal * etude.frais_chantier_pct / 100;
  const fg = (dsTotal + fc) * etude.frais_generaux_pct / 100;
  const al = (dsTotal + fc + fg) * etude.aleas_pct / 100;
  const be = (dsTotal + fc + fg + al) * etude.benefice_pct / 100;
  const tva = round(totalHT * etude.tva_pct / 100);

  return {
    coefficient_k: round(K, 4),
    lignes: lignesCalc,
    debourse_sec: round(dsTotal),
    ds_par_nature: Object.fromEntries(Object.entries(parNature).map(([k, v]) => [k, round(v)])),
    frais_chantier: round(fc),
    frais_generaux: round(fg),
    aleas: round(al),
    benefice: round(be),
    total_theorique_ht: round(dsTotal * K),
    total_ht: totalHT,
    ecart_arrondis: totalHT - round(dsTotal * K),
    tva,
    total_ttc: totalHT + tva,
  };
}

module.exports = {
  NATURES, round, coutPointage, normaliserHeures,
  deboursSecOuvrage, coefficientK, calculerEtude,
};
