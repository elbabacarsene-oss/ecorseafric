import type { Utilisateur } from "@prisma/client";
import { Champ, Selection } from "@/components/Champs";
import { ROLES } from "@/lib/libelles";

export function ChampsUtilisateur({ u, intervenants, intervenantDefaut }: { u?: Utilisateur; intervenants: [string, string][]; intervenantDefaut?: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Champ nom="prenom" libelle="Prénom" requis defaut={u?.prenom} />
      <Champ nom="nom" libelle="Nom" requis defaut={u?.nom} />
      <Champ nom="email" libelle="E-mail (identifiant)" type="email" requis defaut={u?.email} />
      <Champ nom="telephone" libelle="Téléphone" type="tel" defaut={u?.telephone} />
      <Selection nom="role" libelle="Rôle" requis options={Object.entries(ROLES)} defaut={u?.role} />
      <Selection
        nom="intervenantId"
        libelle="Fiche intervenant liée"
        options={intervenants}
        defaut={u?.intervenantId ?? intervenantDefaut}
        vide="— Aucune —"
        aide="Obligatoire pour les comptes externes. Pour les rôles limités à leurs chantiers, ce sont les affectations de cette fiche qui ouvrent l'accès."
      />
    </div>
  );
}
