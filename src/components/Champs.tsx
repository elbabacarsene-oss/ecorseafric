// Champs de formulaire réutilisables (composants serveur ou client).
type Base = { nom: string; libelle: string; requis?: boolean; aide?: string; className?: string };

export function Champ({
  nom, libelle, requis, aide, className, type = "text", defaut, ...rest
}: Base & { type?: string; defaut?: string | number | null } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name" | "type" | "defaultValue">) {
  return (
    <div className={className}>
      <label htmlFor={nom} className="etiquette">
        {libelle} {requis && <span className="text-rose-600">*</span>}
      </label>
      <input id={nom} name={nom} type={type} required={requis} defaultValue={defaut ?? undefined} className="champ" {...rest} />
      {aide && <p className="mt-1 text-xs text-slate-500">{aide}</p>}
    </div>
  );
}

export function ChampMontant(props: Base & { defaut?: string | number | null }) {
  return <Champ {...props} inputMode="numeric" placeholder="0" aide={props.aide ?? "En francs CFA (XOF), sans décimales."} />;
}

export function Selection({
  nom, libelle, requis, aide, className, options, defaut, vide = "— Choisir —",
}: Base & { options: [string, string][]; defaut?: string | null; vide?: string | false }) {
  return (
    <div className={className}>
      <label htmlFor={nom} className="etiquette">
        {libelle} {requis && <span className="text-rose-600">*</span>}
      </label>
      <select id={nom} name={nom} required={requis} defaultValue={defaut ?? ""} className="champ">
        {vide !== false && <option value="">{vide}</option>}
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      {aide && <p className="mt-1 text-xs text-slate-500">{aide}</p>}
    </div>
  );
}

export function ZoneTexte({ nom, libelle, requis, className, defaut, lignes = 3 }: Base & { defaut?: string | null; lignes?: number }) {
  return (
    <div className={className}>
      <label htmlFor={nom} className="etiquette">
        {libelle} {requis && <span className="text-rose-600">*</span>}
      </label>
      <textarea id={nom} name={nom} required={requis} rows={lignes} defaultValue={defaut ?? ""} className="champ" />
    </div>
  );
}

export function CaseACocher({ nom, libelle, defaut, aide }: { nom: string; libelle: string; defaut?: boolean; aide?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={nom} defaultChecked={defaut} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
      <span>
        {libelle}
        {aide && <span className="block text-xs text-slate-500">{aide}</span>}
      </span>
    </label>
  );
}
