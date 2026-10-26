"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type PointChantier = { code: string; nom: string; marche: number; budget: number };

const fcfa = new Intl.NumberFormat("fr-SN", { maximumFractionDigits: 0 });
const compact = (v: number) =>
  Math.abs(v) >= 1e9 ? `${fcfa.format(v / 1e9)} Md` : Math.abs(v) >= 1e6 ? `${fcfa.format(v / 1e6)} M` : fcfa.format(v);

/** Compare, par chantier, le marché actualisé et le budget de référence (coût prévisionnel). */
export function GraphiqueChantiers({ donnees, avecBudget }: { donnees: PointChantier[]; avecBudget: boolean }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <BarChart data={donnees} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} barGap={2}>
          <CartesianGrid vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="code" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#cbd5e1" }} />
          <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} width={60} />
          <Tooltip
            cursor={{ fill: "rgba(23,78,160,0.06)" }}
            formatter={(v: number, n: string) => [`${fcfa.format(v)} F CFA`, n]}
            labelFormatter={(code: string) => {
              const p = donnees.find((d) => d.code === code);
              return p ? `${p.code} · ${p.nom}` : code;
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v: string) => <span style={{ color: "#334155" }}>{v}</span>} />
          <Bar dataKey="marche" name="Marché actualisé" fill="#174ea0" radius={[4, 4, 0, 0]} maxBarSize={28} />
          {avecBudget && <Bar dataKey="budget" name="Budget de référence" fill="#1f9d55" radius={[4, 4, 0, 0]} maxBarSize={28} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
