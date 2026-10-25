"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type LienNav = { href: string; libelle: string; groupe?: string };

export function Navigation({
  liens, utilisateur, role, aLogo, raisonSociale, deconnexion,
}: {
  liens: LienNav[];
  utilisateur: string;
  role: string;
  aLogo: boolean;
  raisonSociale: string;
  deconnexion: () => Promise<void>;
}) {
  const [ouvert, setOuvert] = useState(false);
  const chemin = usePathname();
  const actif = (href: string) => (href === "/" ? chemin === "/" : chemin === href || chemin.startsWith(href + "/"));
  let groupe: string | undefined;

  const marque = (
    <Link href="/" className="flex items-center gap-2" onClick={() => setOuvert(false)}>
      {aLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/api/logo" alt={`Logo ${raisonSociale}`} className="h-9 w-9 rounded bg-white object-contain p-0.5" />
      ) : (
        <span className="flex h-9 w-9 items-center justify-center rounded bg-ecorse-vert-500 text-sm font-bold text-white">EA</span>
      )}
      <span className="leading-tight">
        <span className="block text-sm font-bold text-white">{raisonSociale}</span>
        <span className="block text-[11px] text-ecorse-bleu-100">BTP Manager 360</span>
      </span>
    </Link>
  );

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between bg-ecorse-bleu-900 px-4 py-2 lg:hidden">
        {marque}
        <button
          type="button"
          aria-label={ouvert ? "Fermer le menu" : "Ouvrir le menu"}
          aria-expanded={ouvert}
          onClick={() => setOuvert(!ouvert)}
          className="rounded-md p-2 text-white hover:bg-ecorse-bleu-800"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {ouvert ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </header>
      {ouvert && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOuvert(false)} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-ecorse-bleu-900 text-ecorse-bleu-100 transition-transform lg:translate-x-0 ${
          ouvert ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="border-b border-ecorse-bleu-800 px-4 py-4">{marque}</div>
        <nav className="flex-1 overflow-y-auto px-2 py-3 text-sm">
          {liens.map((l) => {
            const titre = l.groupe && l.groupe !== groupe ? l.groupe : null;
            groupe = l.groupe;
            return (
              <div key={l.href}>
                {titre && <p className="mt-4 px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ecorse-bleu-100/60">{titre}</p>}
                <Link
                  href={l.href}
                  onClick={() => setOuvert(false)}
                  className={`block rounded-md px-3 py-2 ${actif(l.href) ? "bg-ecorse-vert-600 font-medium text-white" : "hover:bg-ecorse-bleu-800 hover:text-white"}`}
                >
                  {l.libelle}
                </Link>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-ecorse-bleu-800 px-4 py-3 text-xs">
          <Link href="/mon-compte" className="block font-medium text-white hover:underline">{utilisateur}</Link>
          <p className="text-ecorse-bleu-100/70">{role}</p>
          <form action={deconnexion} className="mt-2">
            <button type="submit" className="text-ecorse-vert-100 hover:underline">Se déconnecter</button>
          </form>
        </div>
      </aside>
    </>
  );
}
