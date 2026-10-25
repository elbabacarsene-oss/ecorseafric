import Link from "next/link";
import type { StatutChantier } from "@prisma/client";
import { COULEUR_STATUT, STATUTS_CHANTIER } from "@/lib/libelles";

export function BadgeStatut({ statut }: { statut: StatutChantier }) {
  return <span className={`badge ${COULEUR_STATUT[statut]}`}>{STATUTS_CHANTIER[statut]}</span>;
}

export function EnTetePage({ titre, sousTitre, actions }: { titre: string; sousTitre?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1>{titre}</h1>
        {sousTitre && <p className="mt-1 text-sm text-slate-500">{sousTitre}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EtatVide({ message, action }: { message: string; action?: { href: string; libelle: string } }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
      <p>{message}</p>
      {action && (
        <Link href={action.href} className="btn-primaire mt-4">
          {action.libelle}
        </Link>
      )}
    </div>
  );
}

export function Info({ libelle, children }: { libelle: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{libelle}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{children ?? "—"}</dd>
    </div>
  );
}

export function Pagination({ page, total, parPage, params }: { page: number; total: number; parPage: number; params: Record<string, string> }) {
  const pages = Math.max(1, Math.ceil(total / parPage));
  if (pages <= 1) return null;
  const lien = (p: number) => "?" + new URLSearchParams({ ...params, page: String(p) }).toString();
  return (
    <nav className="mt-4 flex items-center justify-between text-sm text-slate-600">
      <span>
        Page {page} sur {pages} · {total} résultat{total > 1 ? "s" : ""}
      </span>
      <div className="flex gap-2">
        {page > 1 && <Link className="btn-secondaire" href={lien(page - 1)}>Précédent</Link>}
        {page < pages && <Link className="btn-secondaire" href={lien(page + 1)}>Suivant</Link>}
      </div>
    </nav>
  );
}
