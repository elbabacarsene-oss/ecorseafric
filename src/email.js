'use strict';
// Envoi des e-mails transactionnels via l'API Brevo.
// Sans clé BREVO_API_KEY (développement, tests), les messages sont écrits dans la console
// et conservés en mémoire (boiteDeTest) : rien n'est réellement envoyé.
const boiteDeTest = [];

function creerEmetteur(cfg) {
  const actif = !!(cfg.brevoApiKey && cfg.expediteur);
  if (!actif) console.warn('[email] BREVO_API_KEY ou EMAIL_EXPEDITEUR absent : les e-mails sont affichés dans la console, pas envoyés.');
  return {
    actif,
    async envoyer({ a, nom, sujet, texte, html }) {
      if (!actif) {
        boiteDeTest.push({ a, sujet, texte });
        if (boiteDeTest.length > 200) boiteDeTest.shift();
        if (process.env.NODE_ENV !== 'test') console.log(`[email] À : ${a}\nSujet : ${sujet}\n${texte}\n`);
        return;
      }
      const res = await fetch(cfg.brevoApiUrl, {
        method: 'POST',
        headers: { 'api-key': cfg.brevoApiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          sender: { email: cfg.expediteur, name: cfg.expediteurNom },
          to: [{ email: a, name: nom || a }],
          subject: sujet, textContent: texte, htmlContent: html,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Envoi e-mail refusé par Brevo (${res.status}) ${detail.slice(0, 200)}`);
      }
    },
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Gabarit commun : un paragraphe d'introduction et un bouton
function gabarit({ produit, titre, intro, bouton, lien, note }) {
  const texte = `${titre}\n\n${intro}\n\n${bouton} : ${lien}\n\n${note}\n\n— ${produit}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1d2733">
  <h2 style="color:#083d6e">${esc(titre)}</h2><p>${esc(intro)}</p>
  <p><a href="${esc(lien)}" style="display:inline-block;background:#2e9e4f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">${esc(bouton)}</a></p>
  <p style="font-size:13px;color:#5f6b7a">Si le bouton ne fonctionne pas, copiez ce lien : <br>${esc(lien)}</p>
  <p style="font-size:13px;color:#5f6b7a">${esc(note)}</p><p style="font-size:13px;color:#5f6b7a">— ${esc(produit)}</p></div>`;
  return { texte, html };
}

module.exports = { creerEmetteur, gabarit, boiteDeTest };
