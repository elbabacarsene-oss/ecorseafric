'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/calc');

test('coût de pointage : heures normales + heures sup majorées', () => {
  // 8 h × 1000 + 2 h × 1000 × 1,15 = 10 300
  assert.equal(C.coutPointage({ presence: 'present', heures_normales: 8, heures_sup: 2, taux_horaire: 1000, majoration_hs_pct: 15 }), 10300);
  assert.equal(C.coutPointage({ presence: 'absent', heures_normales: 8, heures_sup: 0, taux_horaire: 1000, majoration_hs_pct: 15 }), 0);
});

test('heures par défaut selon la présence', () => {
  assert.deepEqual(C.normaliserHeures('present', null, null, 8), { heures_normales: 8, heures_sup: 0 });
  assert.deepEqual(C.normaliserHeures('demi_journee', null, null, 8), { heures_normales: 4, heures_sup: 0 });
  assert.deepEqual(C.normaliserHeures('maladie', 8, 2, 8), { heures_normales: 0, heures_sup: 0 });
});

test('déboursé sec d\'un ouvrage : béton dosé à 350 kg pour 1 m³', () => {
  const ds = C.deboursSecOuvrage(1, [
    { type: 'materiau', quantite: 0.35, pertes_pct: 5, prix_unitaire: 80000 },   // ciment (t) : 0,35 × 1,05 × 80 000 = 29 400
    { type: 'materiau', quantite: 0.8, pertes_pct: 0, prix_unitaire: 12000 },    // gravier : 9 600
    { type: 'main_oeuvre', quantite: 6, pertes_pct: 0, prix_unitaire: 1500 },    // 9 000
    { type: 'materiel', quantite: 0.5, pertes_pct: 0, prix_unitaire: 10000 },    // bétonnière : 5 000
  ]);
  assert.equal(Math.round(ds.materiau), 39000);
  assert.equal(ds.main_oeuvre, 9000);
  assert.equal(ds.materiel, 5000);
  assert.equal(Math.round(ds.total), 53000);
  // quantité de base 10 : divise par 10
  assert.equal(C.deboursSecOuvrage(10, [{ type: 'main_oeuvre', quantite: 10, prix_unitaire: 1500 }]).total, 1500);
});

test('étude : coefficient K et totaux', () => {
  const etude = { frais_chantier_pct: 10, frais_generaux_pct: 12, aleas_pct: 0, benefice_pct: 10, tva_pct: 18 };
  const K = C.coefficientK(etude);
  assert.ok(Math.abs(K - 1.1 * 1.12 * 1.1) < 1e-12);
  const r = C.calculerEtude(etude, [
    { quantite: 10, ds_main_oeuvre: 9000, ds_materiau: 39000, ds_materiel: 5000, ds_sous_traitance: 0 },
    { quantite: 2.5, ds_main_oeuvre: 1000, ds_materiau: 0, ds_materiel: 0, ds_sous_traitance: 0 },
  ]);
  assert.equal(r.debourse_sec, 532500);
  assert.equal(r.ds_par_nature.main_oeuvre, 92500);
  const pu1 = Math.round(53000 * K);
  const pu2 = Math.round(1000 * K);
  assert.equal(r.lignes[0].pu_vente, pu1);
  assert.equal(r.total_ht, pu1 * 10 + Math.round(pu2 * 2.5));
  assert.equal(r.tva, Math.round(r.total_ht * 0.18));
  assert.equal(r.total_ttc, r.total_ht + r.tva);
  // la cascade frais de chantier -> bénéfice retombe sur DS × K
  assert.ok(Math.abs(r.debourse_sec + r.frais_chantier + r.frais_generaux + r.aleas + r.benefice - r.total_theorique_ht) <= 2);
});

test('étude vide : tout vaut zéro', () => {
  const r = C.calculerEtude({ frais_chantier_pct: 10, frais_generaux_pct: 10, aleas_pct: 0, benefice_pct: 10, tva_pct: 18 }, []);
  assert.equal(r.total_ttc, 0);
  assert.equal(r.debourse_sec, 0);
});
