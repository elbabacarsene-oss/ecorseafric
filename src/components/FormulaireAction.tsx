"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";

export type EtatAction = { erreur?: string; succes?: string; jeton?: number } | undefined;
type ActionServeur = (etat: EtatAction, formData: FormData) => Promise<EtatAction>;

function BoutonEnvoi({ libelle, classe, pending }: { libelle: string; classe: string; pending: boolean }) {
  return (
    <button type="submit" className={classe} disabled={pending}>
      {pending ? "Enregistrement…" : libelle}
    </button>
  );
}

/**
 * Formulaire branché sur une action serveur : affiche l'erreur réellement renvoyée par le serveur,
 * et ne confirme l'enregistrement que si le serveur l'a confirmé.
 * Les champs sont vidés après un succès, mais conservés après une erreur pour que l'utilisateur
 * corrige sa saisie au lieu de tout retaper (React 19 vide sinon le formulaire dans les deux cas).
 */
export function FormulaireAction({
  action,
  children,
  libelle = "Enregistrer",
  classeBouton = "btn-primaire",
  confirmation,
  className = "space-y-4",
  actionsSupplementaires,
}: {
  action: ActionServeur;
  children?: React.ReactNode;
  libelle?: string;
  classeBouton?: string;
  confirmation?: string;
  className?: string;
  actionsSupplementaires?: React.ReactNode;
}) {
  const [etat, envoyer, enCours] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (etat?.succes) ref.current?.reset();
  }, [etat]);

  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (enCours || (confirmation && !window.confirm(confirmation))) return;
        const donnees = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => envoyer(donnees));
      }}
    >
      {children}
      {etat?.erreur && (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {etat.erreur}
        </p>
      )}
      {etat?.succes && (
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {etat.succes}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <BoutonEnvoi libelle={libelle} classe={classeBouton} pending={enCours} />
        {actionsSupplementaires}
      </div>
    </form>
  );
}
