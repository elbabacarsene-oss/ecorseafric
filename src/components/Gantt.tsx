"use client";

import { useMemo, useState } from "react";

export type BarreGantt = {
  id: string;
  nom: string;
  niveau: number;
  jalon: boolean;
  recapitulative: boolean;
  debut: string; // AAAA-MM-JJ
  fin: string;
  debutRef: string | null;
  finRef: string | null;
  debutReel: string | null;
  finReelle: string | null;
  avancement: number;
  critique: boolean;
  enRetard: boolean;
  importante: boolean;
  info: string;
};

const JOUR = 86_400_000;
const j = (s: string) => Math.round(new Date(`${s}T00:00:00Z`).getTime() / JOUR);
const ZOOMS = { jour: 26, semaine: 9, mois: 3 } as const;
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** Diagramme de Gantt : prévu (barre), avancement (remplissage), référence (trait gris), chemin critique (rouge). */
export function Gantt({ barres, aujourdhui, finContractuelle }: { barres: BarreGantt[]; aujourdhui: string; finContractuelle: string | null }) {
  const [zoom, setZoom] = useState<keyof typeof ZOOMS>(barres.length && j(barres.reduce((m, b) => (b.fin > m ? b.fin : m), barres[0].fin)) - j(barres[0].debut) > 200 ? "mois" : "semaine");
  const [reference, setReference] = useState(true);
  const [critiqueSeul, setCritiqueSeul] = useState(false);
  const px = ZOOMS[zoom];

  const { debut, fin } = useMemo(() => {
    const dates = barres.flatMap((b) => [b.debut, b.fin, ...(b.debutRef ? [b.debutRef, b.finRef!] : [])]).concat(aujourdhui, finContractuelle ?? []);
    return { debut: Math.min(...dates.map(j)) - 3, fin: Math.max(...dates.map(j)) + 7 };
  }, [barres, aujourdhui, finContractuelle]);
  const largeur = (fin - debut + 1) * px;
  const x = (s: string) => (j(s) - debut) * px;

  const graduations = useMemo(() => {
    const res: { x: number; libelle: string; fort: boolean }[] = [];
    for (let d = debut; d <= fin; d++) {
      const date = new Date(d * JOUR);
      const jourMois = date.getUTCDate();
      if (zoom === "jour") res.push({ x: (d - debut) * px, libelle: String(jourMois), fort: date.getUTCDay() === 1 });
      else if (zoom === "semaine" && date.getUTCDay() === 1) res.push({ x: (d - debut) * px, libelle: `${jourMois} ${MOIS[date.getUTCMonth()]}`, fort: jourMois <= 7 });
      else if (zoom === "mois" && jourMois === 1) res.push({ x: (d - debut) * px, libelle: `${MOIS[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(2)}`, fort: date.getUTCMonth() === 0 });
    }
    return res;
  }, [debut, fin, px, zoom]);

  const visibles = critiqueSeul ? barres.filter((b) => b.critique || b.recapitulative) : barres;
  const H = 30;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="Échelle">
          {(Object.keys(ZOOMS) as (keyof typeof ZOOMS)[]).map((z) => (
            <button key={z} type="button" onClick={() => setZoom(z)} className={`px-3 py-1 ${zoom === z ? "bg-ecorse-bleu-600 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}>
              {z === "jour" ? "Jours" : z === "semaine" ? "Semaines" : "Mois"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1"><input type="checkbox" checked={reference} onChange={(e) => setReference(e.target.checked)} /> Planning de référence</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={critiqueSeul} onChange={(e) => setCritiqueSeul(e.target.checked)} /> Chemin critique seul</label>
        <span className="flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded bg-ecorse-bleu-500" /> prévu</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded bg-rose-500" /> critique</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded bg-ecorse-vert-500" /> avancement</span>
          <span className="flex items-center gap-1"><span className="inline-block h-1 w-5 bg-slate-400" /> référence</span>
        </span>
      </div>
      <div className="flex overflow-hidden rounded-lg border border-slate-200 text-xs">
        <div className="w-40 shrink-0 border-r border-slate-200 bg-white sm:w-64">
          <div className="h-8 border-b border-slate-200 bg-slate-50 px-2 py-2 font-semibold text-slate-500">Tâche</div>
          {visibles.map((b) => (
            <a key={b.id} href={`#tache-${b.id}`} title={b.info} className={`flex items-center gap-1 truncate border-b border-slate-100 px-2 hover:bg-slate-50 ${b.recapitulative ? "font-semibold" : ""} ${b.enRetard ? "text-rose-700" : ""}`} style={{ height: H, paddingLeft: 8 + b.niveau * 12 }}>
              {b.jalon ? "◆ " : ""}{b.nom}{b.importante && <span className="text-amber-600" title="Tâche importante">★</span>}
            </a>
          ))}
        </div>
        <div className="flex-1 overflow-x-auto">
          <div className="relative" style={{ width: largeur }}>
            <div className="relative h-8 border-b border-slate-200 bg-slate-50">
              {graduations.map((g, i) => (
                <span key={i} className={`absolute top-0 h-full border-l pl-1 pt-2 ${g.fort ? "border-slate-400 font-semibold" : "border-slate-200"} text-slate-500`} style={{ left: g.x }}>{g.libelle}</span>
              ))}
            </div>
            <div className="relative" style={{ height: visibles.length * H }}>
              {graduations.map((g, i) => <span key={i} className={`absolute top-0 h-full border-l ${g.fort ? "border-slate-200" : "border-slate-100"}`} style={{ left: g.x }} />)}
              <span className="absolute top-0 z-10 h-full border-l-2 border-amber-500" style={{ left: x(aujourdhui) + px / 2 }} title="Aujourd'hui" />
              {finContractuelle && <span className="absolute top-0 z-10 h-full border-l-2 border-dashed border-rose-500" style={{ left: x(finContractuelle) + px }} title="Fin contractuelle actualisée" />}
              {visibles.map((b, i) => {
                const top = i * H;
                const g = x(b.debut);
                const w = (j(b.fin) - j(b.debut) + 1) * px;
                return (
                  <div key={b.id} className="absolute left-0 w-full border-b border-slate-50" style={{ top, height: H }} title={b.info}>
                    {reference && b.debutRef && b.finRef && (
                      <span className="absolute h-1 rounded bg-slate-400" style={{ left: x(b.debutRef), width: Math.max(px, (j(b.finRef) - j(b.debutRef) + 1) * px), top: H - 7 }} />
                    )}
                    {b.jalon ? (
                      <span className={`absolute h-3.5 w-3.5 rotate-45 ${b.critique ? "bg-rose-600" : "bg-ecorse-bleu-700"}`} style={{ left: g + px / 2 - 7, top: 7 }} />
                    ) : b.recapitulative ? (
                      <span className="absolute h-2 rounded-sm bg-slate-700" style={{ left: g, width: w, top: 9 }}>
                        <span className="absolute left-0 top-0 h-full rounded-sm bg-ecorse-vert-500" style={{ width: `${b.avancement}%` }} />
                      </span>
                    ) : (
                      <span className={`absolute overflow-hidden rounded ${b.critique ? "bg-rose-300" : "bg-ecorse-bleu-100"} ${b.enRetard ? "ring-2 ring-rose-600" : ""}`} style={{ left: g, width: w, top: 5, height: 15 }}>
                        <span className={`absolute left-0 top-0 h-full ${b.critique ? "bg-rose-500" : "bg-ecorse-bleu-500"}`} style={{ width: "100%", opacity: 0.35 }} />
                        <span className="absolute left-0 top-0 h-full bg-ecorse-vert-500" style={{ width: `${b.avancement}%` }} />
                        {w > 34 && <span className="absolute inset-0 pl-1 text-[10px] font-medium leading-[15px] text-slate-900">{b.avancement} %</span>}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">Ligne orange : aujourd'hui · ligne rouge pointillée : fin contractuelle actualisée · survolez une barre pour le détail, cliquez sur un nom pour modifier la tâche.</p>
    </div>
  );
}
