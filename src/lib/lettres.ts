// Montant en toutes lettres (usage des devis et factures au Sénégal : « Arrêté le présent devis à la somme de … »).
const UNITES = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize"];
const DIZAINES = ["", "dix", "vingt", "trente", "quarante", "cinquante", "soixante", "soixante", "quatre-vingt", "quatre-vingt"];

function moinsDeCent(n: number): string {
  if (n <= 16) return UNITES[n];
  if (n < 20) return "dix-" + UNITES[n - 10];
  const d = Math.floor(n / 10);
  let u = n % 10;
  if (d === 7 || d === 9) u += 10;
  const base = DIZAINES[d];
  if (u === 0) return d === 8 ? "quatre-vingts" : base;
  if ((u === 1 || u === 11) && d < 8) return `${base} et ${UNITES[u]}`;
  return `${base}-${u < 17 ? UNITES[u] : moinsDeCent(u)}`;
}

function moinsDeMille(n: number): string {
  const c = Math.floor(n / 100);
  const r = n % 100;
  if (c === 0) return moinsDeCent(r);
  const cent = c === 1 ? "cent" : `${UNITES[c]} cent${r === 0 ? "s" : ""}`;
  return r === 0 ? cent : `${cent} ${moinsDeCent(r)}`;
}

/** 1 250 000 → « un million deux cent cinquante mille ». Entiers positifs jusqu'à 999 999 999 999 999. */
export function nombreEnLettres(n: number): string {
  n = Math.round(Math.abs(n));
  if (n === 0) return "zéro";
  const groupes: [number, string, string][] = [
    [1e12, "billion", "billions"],
    [1e9, "milliard", "milliards"],
    [1e6, "million", "millions"],
  ];
  const morceaux: string[] = [];
  for (const [v, sing, plur] of groupes) {
    const q = Math.floor(n / v);
    if (q > 0) {
      morceaux.push(`${nombreEnLettres(q)} ${q > 1 ? plur : sing}`);
      n -= q * v;
    }
  }
  const milliers = Math.floor(n / 1000);
  if (milliers > 0) {
    // « mille » est invariable ; « quatre-vingts » et « cents » perdent leur s devant mille
    morceaux.push(milliers === 1 ? "mille" : `${moinsDeMille(milliers).replace(/(cent|vingt)s$/, "$1")} mille`);
    n -= milliers * 1000;
  }
  if (n > 0) morceaux.push(moinsDeMille(n));
  return morceaux.join(" ");
}

export function montantEnLettres(n: number): string {
  const t = nombreEnLettres(n);
  return `${t.charAt(0).toUpperCase()}${t.slice(1)} francs CFA`;
}
