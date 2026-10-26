"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type PointBudget = { libelle: string; initial: number; actualise: number };

const fcfa = new Intl.NumberFormat("fr-SN", { maximumFractionDigits: 0 });
const compact = (v: number) => (Math.abs(v) >= 1e9 ? `${fcfa.format(v / 1e9)} Md` : Math.abs(v) >= 1e6 ? `${fcfa.format(v / 1e6)} M` : fcfa.format(v));

/** Budget initial et actualisé par poste. */
export function GraphiqueBudget({ donnees }: { donnees: PointBudget[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={donnees} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} barGap={2}>
          <CartesianGrid vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="libelle" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#cbd5e1" }} interval={0} />
          <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} width={60} />
          <Tooltip cursor={{ fill: "rgba(23,78,160,0.06)" }} formatter={(v: number, n: string) => [`${fcfa.format(v)} F CFA`, n]} />
          <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v: string) => <span style={{ color: "#334155" }}>{v}</span>} />
          <Bar dataKey="initial" name="Budget initial" fill="#174ea0" radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="actualise" name="Budget actualisé" fill="#1f9d55" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
