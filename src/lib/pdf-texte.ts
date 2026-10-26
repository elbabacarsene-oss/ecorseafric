// Conversion d'un texte vers le jeu de caractères des polices PDF standard (WinAnsi). Pur, testé.
const SPECIAUX = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const REMPLACEMENTS: Record<string, string> = {
  " ": " ", // espace fine insécable (séparateur de milliers fr)
  " ": " ",
  " ": " ",
  "→": "->",
  "←": "<-",
  "≤": "<=",
  "≥": ">=",
  "×": "x",
  "✓": "OK",
  "\t": "  ",
  "\r": "",
};

export function texteWinAnsi(s: string): string {
  let r = "";
  for (const c of s.normalize("NFC")) {
    const code = c.codePointAt(0)!;
    if (REMPLACEMENTS[c] !== undefined) r += REMPLACEMENTS[c];
    else if (c === "\n" || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || SPECIAUX.includes(c)) r += c;
    else r += "?";
  }
  return r;
}
