"use client";

import { useState } from "react";

/**
 * Champ fichier. Avec `compresser`, les photos sont redimensionnées (1600 px, JPEG 80 %) dans le navigateur avant
 * l'envoi : une photo de smartphone de 5 Mo passe sous 500 Ko, ce qui reste rapide sur une connexion mobile.
 */
export function ChampFichier({
  nom, libelle, requis, multiple, accept, compresser, aide, capture,
}: {
  nom: string;
  libelle: string;
  requis?: boolean;
  multiple?: boolean;
  accept?: string;
  compresser?: boolean;
  aide?: string;
  capture?: boolean;
}) {
  const [info, setInfo] = useState<string | null>(null);

  async function reduire(f: File): Promise<File> {
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return f;
    try {
      const bmp = await createImageBitmap(f);
      const echelle = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * echelle);
      c.height = Math.round(bmp.height * echelle);
      c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.8));
      if (!blob || blob.size >= f.size) return f;
      return new File([blob], f.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: f.lastModified });
    } catch {
      return f;
    }
  }

  return (
    <div>
      <label htmlFor={nom} className="etiquette">
        {libelle} {requis && <span className="text-rose-600">*</span>}
      </label>
      <input
        id={nom}
        name={nom}
        type="file"
        required={requis}
        multiple={multiple}
        accept={accept}
        {...(capture ? { capture: "environment" as const } : {})}
        className="champ"
        onChange={async (e) => {
          const input = e.currentTarget;
          if (!compresser || !input.files?.length) return;
          setInfo("Préparation des photos…");
          const dt = new DataTransfer();
          let avant = 0;
          let apres = 0;
          for (const f of Array.from(input.files)) {
            const r = await reduire(f);
            avant += f.size;
            apres += r.size;
            dt.items.add(r);
          }
          input.files = dt.files;
          setInfo(`${dt.files.length} photo(s) prête(s) : ${(apres / 1024 / 1024).toFixed(1)} Mo (au lieu de ${(avant / 1024 / 1024).toFixed(1)} Mo).`);
        }}
      />
      {info && <p className="mt-1 text-xs text-slate-500">{info}</p>}
      {aide && <p className="mt-1 text-xs text-slate-500">{aide}</p>}
    </div>
  );
}
