import Link from "next/link";

export default function Introuvable() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="carte max-w-md text-center">
        <h1>Page introuvable</h1>
        <p className="mt-2 text-sm text-slate-600">Cet élément n'existe pas ou vous n'y avez pas accès.</p>
        <Link href="/" className="btn-primaire mt-4">Retour à l'accueil</Link>
      </div>
    </main>
  );
}
