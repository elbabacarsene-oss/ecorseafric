"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

export type EtatAction = { erreur?: string; succes?: string; jeton?: number } | undefined;
type ActionServeur = (etat: EtatAction, formData: FormData) => Promise<EtatAction>;

function BoutonEnvoi({ libelle, classe }: { libelle: string; classe: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={classe} disabled={pending}>
      {pending ? "Enregistrement…" : libelle}
    </button>
  );
}

/**
 * Formulaire branché sur une action serveur : affiche l'erreur réellement renvoyée par le serveur,
 * et ne confirme l'enregistrement que si le serveur l'a confirmé.
 */
export function FormulaireAction({
  action,
  children,
  libelle = "Enregistrer",
  classeBouton = "btn-primaire",
  reinitialiser = false,
  confirmation,
  className = "space-y-4",
  actionsSupplementaires,
}: {
  action: ActionServeur;
  children?: React.ReactNode;
  libelle?: string;
  classeBouton?: string;
  reinitialiser?: boolean;
  confirmation?: string;
  className?: string;
  actionsSupplementaires?: React.ReactNode;
}) {
  const [etat, envoyer] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (reinitialiser && etat?.succes) ref.current?.reset();
  }, [etat, reinitialiser]);

  return (
    <form
      ref={ref}
      action={envoyer}
      className={className}
      onSubmit={(e) => {
        if (confirmation && !window.confirm(confirmation)) e.preventDefault();
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
        <BoutonEnvoi libelle={libelle} classe={classeBouton} />
        {actionsSupplementaires}
      </div>
    </form>
  );
}
