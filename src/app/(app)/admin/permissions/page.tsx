import type { Role } from "@prisma/client";
import { EnTetePage } from "@/components/ui";
import { exigerUtilisateur } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ROLES } from "@/lib/libelles";
import { ACTIONS, MATRICE, MODULES, type Action, type Module } from "@/lib/permissions";

export const metadata = { title: "Matrice des permissions" };

const COURT: Record<Action, string> = { lire: "C", creer: "Cr", modifier: "M", supprimer: "S", approuver: "A" };

export default async function PageMatrice() {
  const user = await exigerUtilisateur();
  if (user.externe) redirect("/acces-refuse");
  const roles = Object.keys(ROLES) as Role[];
  const modules = Object.keys(MODULES) as Module[];
  return (
    <>
      <EnTetePage
        titre="Matrice des permissions"
        sousTitre="Générée à partir des règles appliquées par le serveur : ce tableau est exactement ce que l'application contrôle."
      />
      <div className="carte mb-4 text-sm">
        <p><strong>Légende :</strong> {Object.entries(ACTIONS).map(([a, l]) => `${COURT[a as Action]} = ${l}`).join(" · ")}</p>
        <p className="mt-1"><span className="badge bg-ecorse-vert-100 text-ecorse-vert-800">vert</span> tous les chantiers ou enregistrements · <span className="badge bg-ecorse-bleu-100 text-ecorse-bleu-800">bleu</span> seulement les chantiers où la personne est affectée (pour les comptes externes : affectation avec accès portail ouvert).</p>
        <p className="mt-1">Séparation des tâches : un avenant ne peut pas être approuvé par la personne qui l'a préparé.</p>
      </div>
      <div className="carte overflow-x-auto p-0">
        <table className="tableau">
          <thead>
            <tr><th className="sticky left-0 bg-slate-50">Rôle</th>{modules.map((m) => <th key={m}>{MODULES[m]}</th>)}</tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r}>
                <td className="sticky left-0 whitespace-nowrap bg-white font-medium">{ROLES[r]}</td>
                {modules.map((m) => {
                  const droits = MATRICE[r][m] ?? {};
                  const actions = (Object.keys(ACTIONS) as Action[]).filter((a) => droits[a]);
                  return (
                    <td key={m} className="whitespace-nowrap">
                      {actions.length === 0 ? <span className="text-slate-300">—</span> : actions.map((a) => (
                        <span key={a} title={`${ACTIONS[a]} (${droits[a] === "tous" ? "tous" : "chantiers affectés"})`}
                          className={`badge mr-0.5 ${droits[a] === "tous" ? "bg-ecorse-vert-100 text-ecorse-vert-800" : "bg-ecorse-bleu-100 text-ecorse-bleu-800"}`}>
                          {COURT[a]}
                        </span>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
