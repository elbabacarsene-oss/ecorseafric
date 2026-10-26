import { describe, expect, it } from "vitest";
import { avancementGlobal, cheminCritique, dureeJours, ecartReference, etatTache, trouverCycle } from "@/lib/planning-calculs";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const tache = (id: string, debut: string, fin: string, extra = {}) => ({ id, type: "TACHE" as const, debutPrevu: d(debut), finPrevue: d(fin), ...extra });

describe("planning", () => {
  it("durée en jours calendaires inclusifs ; jalon = 0", () => {
    expect(dureeJours(tache("a", "2026-11-02", "2026-11-04"))).toBe(3);
    expect(dureeJours({ type: "JALON", debutPrevu: d("2026-11-04"), finPrevue: d("2026-11-04") })).toBe(0);
  });

  it("détecte une boucle de dépendances", () => {
    expect(trouverCycle(["a", "b", "c"], [
      { predecesseurId: "a", successeurId: "b", decalageJours: 0 },
      { predecesseurId: "b", successeurId: "c", decalageJours: 0 },
      { predecesseurId: "c", successeurId: "a", decalageJours: 0 },
    ])).toEqual(["a", "b", "c", "a"]);
    expect(trouverCycle(["a", "b"], [{ predecesseurId: "a", successeurId: "b", decalageJours: 0 }])).toBeNull();
  });

  it("un jalon daté du dernier jour d'une tâche la suit sans conflit et reste à cette date", () => {
    const jalon = { id: "J", type: "JALON" as const, debutPrevu: d("2026-11-04"), finPrevue: d("2026-11-04") };
    const r = cheminCritique([tache("A", "2026-11-02", "2026-11-04"), jalon], [{ predecesseurId: "A", successeurId: "J", decalageJours: 0 }]);
    expect(r.conflits).toEqual([]);
    expect(r.dates.get("J")).toEqual({ debut: d("2026-11-04"), fin: d("2026-11-04") });
    expect([...r.critiques].sort()).toEqual(["A", "J"]);
    expect(r.finProjet).toEqual(d("2026-11-04"));
    // Une tâche après le jalon commence le lendemain
    const r2 = cheminCritique([tache("A", "2026-11-02", "2026-11-04"), jalon, tache("B", "2026-11-04", "2026-11-05")],
      [{ predecesseurId: "A", successeurId: "J", decalageJours: 0 }, { predecesseurId: "J", successeurId: "B", decalageJours: 0 }]);
    expect(r2.dates.get("B")!.debut).toEqual(d("2026-11-05"));
  });

  it("chemin critique : A(3j) → B(5j) → D ; A → C(2j) → D ; C a 3 jours de marge", () => {
    const taches = [
      tache("A", "2026-11-02", "2026-11-04"),
      tache("B", "2026-11-05", "2026-11-09"),
      tache("C", "2026-11-05", "2026-11-06"),
      tache("D", "2026-11-10", "2026-11-11"),
    ];
    const deps = [
      { predecesseurId: "A", successeurId: "B", decalageJours: 0 },
      { predecesseurId: "A", successeurId: "C", decalageJours: 0 },
      { predecesseurId: "B", successeurId: "D", decalageJours: 0 },
      { predecesseurId: "C", successeurId: "D", decalageJours: 0 },
    ];
    const r = cheminCritique(taches, deps);
    expect([...r.critiques].sort()).toEqual(["A", "B", "D"]);
    expect(r.marge.get("C")).toBe(3);
    expect(r.finProjet).toEqual(d("2026-11-11"));
    expect(r.conflits).toEqual([]);
  });

  it("signale et repousse une tâche qui commence avant la fin de son prédécesseur (+ décalage)", () => {
    const taches = [tache("A", "2026-11-02", "2026-11-04"), tache("B", "2026-11-03", "2026-11-05")];
    const r = cheminCritique(taches, [{ predecesseurId: "A", successeurId: "B", decalageJours: 2 }]);
    expect(r.conflits).toEqual([{ predecesseurId: "A", successeurId: "B", joursManquants: 4 }]);
    // B doit commencer le 07/11 (fin A le 04 + 1 jour + 2 jours de séchage) et garde sa durée de 3 jours
    expect(r.dates.get("B")).toEqual({ debut: d("2026-11-07"), fin: d("2026-11-09") });
  });

  it("refuse une boucle", () => {
    expect(() => cheminCritique([tache("A", "2026-11-02", "2026-11-02"), tache("B", "2026-11-02", "2026-11-02")], [
      { predecesseurId: "A", successeurId: "B", decalageJours: 0 },
      { predecesseurId: "B", successeurId: "A", decalageJours: 0 },
    ])).toThrow(/boucle/);
  });

  it("retard : fin prévue dépassée et tâche non terminée", () => {
    const t = tache("A", "2026-11-02", "2026-11-11", { avancement: 40 });
    expect(etatTache(t, d("2026-11-06")).enRetard).toBe(false);
    expect(etatTache(t, d("2026-11-06")).avancementAttendu).toBe(50);
    expect(etatTache(t, d("2026-11-14"))).toMatchObject({ enRetard: true, joursRetard: 3 });
    expect(etatTache({ ...t, avancement: 100 }, d("2026-11-14")).enRetard).toBe(false);
    expect(etatTache({ ...t, avancement: 0 }, d("2026-11-04")).demarrageEnRetard).toBe(true);
  });

  it("écart par rapport au planning de référence", () => {
    expect(ecartReference({ finPrevue: d("2026-11-20"), finReference: d("2026-11-15") })).toBe(5);
    expect(ecartReference({ finPrevue: d("2026-11-20"), finReference: null })).toBeNull();
  });

  it("avancement global pondéré par la durée, hors tâches récapitulatives et jalons", () => {
    const taches = [
      tache("P", "2026-11-01", "2026-11-30", { avancement: 0 }),
      tache("A", "2026-11-01", "2026-11-10", { parentId: "P", avancement: 100 }),
      tache("B", "2026-11-11", "2026-11-30", { parentId: "P", avancement: 25 }),
      { id: "J", type: "JALON" as const, debutPrevu: d("2026-11-30"), finPrevue: d("2026-11-30"), avancement: 0 },
    ];
    expect(avancementGlobal(taches)).toBe(Math.round((10 * 100 + 20 * 25) / 30));
    expect(avancementGlobal([])).toBeNull();
  });
});
