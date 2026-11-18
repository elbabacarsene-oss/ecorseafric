'use strict';
/* Mode hors ligne : file d'attente des saisies de pointage sur l'appareil (IndexedDB) et synchronisation.
 *
 * Principe (« boîte d'envoi ») : chaque enregistrement est d'abord écrit sur l'appareil, puis envoyé.
 * Rien n'est perdu si le réseau coupe pendant l'envoi. Chaque opération porte un identifiant unique :
 * le serveur ne l'applique qu'une fois, même si elle est renvoyée. Chaque ligne porte la version lue :
 * si quelqu'un l'a modifiée entre-temps, le serveur la signale en conflit au lieu de l'écraser.
 */
const HorsLigne = (() => {
  const NOM_BASE = 'btp-hors-ligne';
  let basePromise = null;

  function ouvrir() {
    if (!basePromise) {
      basePromise = new Promise((ok, ko) => {
        const req = indexedDB.open(NOM_BASE, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('operations', { keyPath: 'id' });
          db.createObjectStore('evenements', { keyPath: 'id', autoIncrement: true });
        };
        req.onsuccess = () => ok(req.result);
        req.onerror = () => ko(req.error);
      });
    }
    return basePromise;
  }

  async function magasin(nom, mode, fn) {
    const db = await ouvrir();
    return new Promise((ok, ko) => {
      const t = db.transaction(nom, mode);
      const r = fn(t.objectStore(nom));
      t.oncomplete = () => ok(r && 'result' in r ? r.result : undefined);
      t.onerror = () => ko(t.error);
      t.onabort = () => ko(t.error);
    });
  }
  const tout = (nom) => magasin(nom, 'readonly', (s) => s.getAll());
  const ecrire = (nom, v) => magasin(nom, 'readwrite', (s) => s.put(v));
  const effacer = (nom, cle) => magasin(nom, 'readwrite', (s) => s.delete(cle));

  const operations = async (userId) => (await tout('operations'))
    .filter((o) => o.user_id === userId).sort((a, b) => a.cree_le.localeCompare(b.cree_le));
  const evenements = async (userId) => (await tout('evenements')).filter((e) => e.user_id === userId).reverse();

  // Ajoute une saisie de feuille à la file. Si une saisie de la même feuille attend encore
  // et n'a jamais été envoyée, on la complète (une seule opération par feuille hors ligne).
  async function ajouter({ userId, chantierId, chantierCode, date, lignes }) {
    // Fusion possible seulement si l'opération n'a jamais pu atteindre le serveur
    const enAttente = (await operations(userId)).find((o) => o.chantier_id === chantierId && o.date === date && o.statut === 'en_attente');
    if (enAttente && !enAttente.incertaine) {
      const parOuvrier = new Map(enAttente.lignes.map((l) => [l.ouvrier_id, l]));
      for (const l of lignes) {
        // la version attendue reste celle lue initialement sur le serveur
        const prec = parOuvrier.get(l.ouvrier_id);
        if (!prec) { parOuvrier.set(l.ouvrier_id, l); continue; }
        const { version, ...reste } = l;
        parOuvrier.set(l.ouvrier_id, prec.version_de !== undefined
          ? { ...reste, version_de: prec.version_de, version_base: prec.version_base }
          : { ...reste, version: prec.version });
      }
      enAttente.lignes = [...parOuvrier.values()];
      enAttente.modifie_le = new Date().toISOString();
      await ecrire('operations', enAttente);
      return enAttente;
    }
    // Une opération précédente de cette feuille a peut-être déjà atteint le serveur : pour ses lignes,
    // la version attendue sera celle que le serveur renverra pour elle (chaînage), ou à défaut celle qu'elle attendait.
    const precedentes = new Map();
    for (const o of await operations(userId)) {
      if (o.chantier_id === chantierId && o.date === date) for (const l of o.lignes) precedentes.set(l.ouvrier_id, { op: o.id, version: l.version_base ?? l.version ?? null });
    }
    const op = {
      id: crypto.randomUUID(), user_id: userId, chantier_id: chantierId, chantier_code: chantierCode, date,
      lignes: lignes.map((l) => {
        const prec = precedentes.get(l.ouvrier_id);
        if (!prec) return l;
        const { version, ...reste } = l;
        return { ...reste, version_de: prec.op, version_base: prec.version };
      }),
      cree_le: new Date().toISOString(), tentatives: 0, statut: 'en_attente', erreur: null, incertaine: false,
    };
    await ecrire('operations', op);
    return op;
  }

  // Lignes en attente d'envoi pour une feuille (affichées par-dessus la feuille du serveur)
  async function enAttentePourFeuille(userId, chantierId, date) {
    const m = new Map();
    for (const o of await operations(userId)) {
      if (o.chantier_id === chantierId && o.date === date) for (const l of o.lignes) m.set(l.ouvrier_id, { ...l, op_statut: o.statut });
    }
    return m;
  }

  let enCours = null;
  // Envoie les opérations en attente, dans l'ordre. S'arrête à la première coupure réseau.
  function synchroniser(userId) {
    if (enCours) return enCours;
    enCours = (async () => {
      const bilan = { envoyees: 0, conflits: 0, echecs: 0, reste: 0, connexion_requise: false, hors_ligne: false };
      for (const ref of await operations(userId)) {
        if (ref.statut !== 'en_attente') continue;
        // Sans réseau, aucune tentative : l'opération reste modifiable (fusion des saisies suivantes)
        if (!navigator.onLine) { bilan.hors_ligne = true; break; }
        const op = (await tout('operations')).find((o) => o.id === ref.id);
        if (!op) continue;
        op.tentatives += 1;
        op.derniere_tentative = new Date().toISOString();
        // À partir d'ici la requête peut atteindre le serveur : on ne fusionnera plus de nouvelles saisies dedans
        op.incertaine = true;
        await ecrire('operations', op);
        // Lignes chaînées sur une opération précédente qui n'a pas abouti : on garde la version qu'elle attendait
        const lignes = op.lignes.map(({ version_de, version_base, ...l }) => (version_de !== undefined ? { ...l, version: version_base } : l));
        let res;
        try {
          res = await fetch(`/api/chantiers/${op.chantier_id}/pointage`, {
            method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: op.date, operation_id: op.id, saisi_hors_ligne_le: op.cree_le, lignes }),
          });
        } catch {
          bilan.hors_ligne = true;
          break;
        }
        const data = await res.json().catch(() => ({}));
        if (res.status === 503 && data.code === 'hors_ligne') { bilan.hors_ligne = true; break; }
        if (res.status === 401) { bilan.connexion_requise = true; break; }
        if (res.status === 402 || res.status >= 500) { op.erreur = data.error || `Erreur ${res.status}`; await ecrire('operations', op); break; }
        if (!res.ok) {
          // Refus définitif (ouvrier désaffecté, date invalide…) : conservé pour que l'utilisateur décide
          op.statut = 'echec'; op.erreur = data.error || `Erreur ${res.status}`;
          await ecrire('operations', op);
          bilan.echecs++;
          continue;
        }
        await effacer('operations', op.id);
        bilan.envoyees++;
        // Chaînage : les opérations suivantes de la même feuille attendent les versions que le serveur vient d'écrire
        for (const suivante of await operations(userId)) {
          let modifiee = false;
          for (const l of suivante.lignes) {
            if (l.version_de !== op.id) continue;
            const v = data.versions && data.versions[l.ouvrier_id];
            delete l.version_de;
            l.version = v !== undefined ? v : l.version_base; // ligne non appliquée : on garde l'ancienne attente (=> conflit signalé)
            delete l.version_base;
            modifiee = true;
          }
          if (modifiee) await ecrire('operations', suivante);
        }
        const signalements = [...(data.conflits || []).map((c) => ({ ...c, type: 'conflit' })), ...(data.ignorees || []).map((c) => ({ ...c, type: 'ignoree' }))];
        if (signalements.length) {
          bilan.conflits += signalements.length;
          await ecrire('evenements', { user_id: userId, le: new Date().toISOString(), chantier_id: op.chantier_id, chantier_code: op.chantier_code, date: op.date, details: signalements });
        }
      }
      bilan.reste = (await operations(userId)).length;
      return bilan;
    })().finally(() => { enCours = null; });
    return enCours;
  }

  async function marquerAReessayer(id) {
    const op = (await tout('operations')).find((o) => o.id === id);
    if (op) { op.statut = 'en_attente'; op.erreur = null; await ecrire('operations', op); }
  }

  return {
    disponible: typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && !!crypto.randomUUID,
    ajouter, operations, evenements, enAttentePourFeuille, synchroniser, marquerAReessayer,
    supprimerOperation: (id) => effacer('operations', id),
    supprimerEvenement: (id) => effacer('evenements', id),
  };
})();
