'use strict';
const express = require('express');
const { requireAuth, can } = require('../auth');
const { filtreChantiers, aujourdhuiDakar } = require('../util');
const { round } = require('../calc');

const COUT = `p.taux_horaire * (p.heures_normales + p.heures_sup * (1 + p.majoration_hs_pct/100.0))`;

// Tous les indicateurs proviennent de la base. Aucune donnée n'est inventée :
// en l'absence d'enregistrements, les compteurs valent zéro.
module.exports = function dashboardRoutes(db) {
  const r = express.Router();

  r.get('/tableau-de-bord', requireAuth, (req, res) => {
    const u = req.user;
    const f = filtreChantiers(db, u);
    const fp = filtreChantiers(db, u, 'p.chantier_id');
    const jour = aujourdhuiDakar();
    const mois = jour.slice(0, 7);

    const statuts = Object.fromEntries(db.prepare(`SELECT statut, COUNT(*) AS n FROM chantiers c WHERE c.org_id = ?${f.sql} GROUP BY statut`)
      .all(u.org_id, ...f.params).map((x) => [x.statut, x.n]));
    const enRetard = db.prepare(`SELECT COUNT(*) AS n FROM chantiers c WHERE c.org_id = ?${f.sql}
      AND c.statut IN ('en_cours','suspendu') AND c.date_fin_prevue IS NOT NULL AND c.date_fin_prevue < ?`).get(u.org_id, ...f.params, jour).n;

    const out = {
      date: jour,
      chantiers: {
        en_cours: statuts.en_cours || 0, preparation: statuts.preparation || 0, suspendus: statuts.suspendu || 0,
        termines: (statuts.termine || 0) + (statuts.receptionne || 0), en_retard: enRetard,
      },
    };

    if (can(u, 'pointage.lire')) {
      const pj = db.prepare(`SELECT
          COUNT(DISTINCT CASE WHEN p.presence IN ('present','demi_journee') THEN p.ouvrier_id END) AS presents,
          COUNT(DISTINCT CASE WHEN p.presence NOT IN ('present','demi_journee') THEN p.ouvrier_id END) AS absents
        FROM pointages p WHERE p.org_id = ? AND p.date = ?${fp.sql}`).get(u.org_id, jour, ...fp.params);
      out.pointage = {
        presents_aujourdhui: pj.presents, absents_aujourdhui: pj.absents,
        ouvriers_actifs: db.prepare('SELECT COUNT(*) AS n FROM ouvriers WHERE org_id = ? AND actif = 1').get(u.org_id).n,
        lignes_a_valider: db.prepare(`SELECT COUNT(*) AS n FROM pointages p WHERE p.org_id = ? AND p.statut = 'saisi'${fp.sql}`).get(u.org_id, ...fp.params).n,
        jours_a_valider: db.prepare(`SELECT p.chantier_id, c.code, c.nom, p.date, COUNT(*) AS lignes FROM pointages p JOIN chantiers c ON c.id = p.chantier_id
          WHERE p.org_id = ? AND p.statut = 'saisi'${fp.sql} GROUP BY p.chantier_id, p.date ORDER BY p.date LIMIT 20`).all(u.org_id, ...fp.params),
      };
    }

    if (can(u, 'cout.lire')) {
      out.couts = {
        mois,
        mo_validee_mois: round(db.prepare(`SELECT COALESCE(SUM(${COUT}), 0) AS c FROM pointages p WHERE p.org_id = ? AND p.statut = 'valide'
          AND p.presence IN ('present','demi_journee') AND substr(p.date, 1, 7) = ?${fp.sql}`).get(u.org_id, mois, ...fp.params).c),
        // Comparaison par chantier : MO réelle (validée) / MO prévue (étude acceptée ou validée)
        par_chantier: db.prepare(`SELECT c.id, c.code, c.nom, c.statut,
            COALESCE((SELECT SUM(${COUT}) FROM pointages p WHERE p.chantier_id = c.id AND p.statut = 'valide' AND p.presence IN ('present','demi_journee')), 0) AS mo_reelle,
            (SELECT SUM(l.ds_main_oeuvre * l.quantite) FROM etude_lignes l WHERE l.etude_id = (
              SELECT e.id FROM etudes e WHERE e.chantier_id = c.id AND e.statut IN ('accepte','valide') ORDER BY e.statut = 'accepte' DESC, e.id DESC LIMIT 1)) AS mo_prevue
          FROM chantiers c WHERE c.org_id = ? AND c.statut IN ('preparation','en_cours','suspendu')${f.sql} ORDER BY c.code`).all(u.org_id, ...f.params)
          .map((x) => ({ ...x, mo_reelle: round(x.mo_reelle), mo_prevue: x.mo_prevue === null ? null : round(x.mo_prevue),
            consommation_pct: x.mo_prevue ? round((x.mo_reelle / x.mo_prevue) * 100, 1) : null })),
      };
    }

    if (can(u, 'debourse.lire')) {
      out.etudes = Object.fromEntries(db.prepare('SELECT statut, COUNT(*) AS n FROM etudes WHERE org_id = ? GROUP BY statut').all(u.org_id).map((x) => [x.statut, x.n]));
    }
    res.json(out);
  });

  return r;
};
