import Link from "next/link";

export const metadata = { title: "Accès refusé" };

export default function AccesRefuse() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="carte max-w-md text-center">
        <h1>Accès refusé</h1>
        <p className="mt-2 text-sm text-slate-600">Votre rôle ne vous autorise pas à consulter cette page. Si vous pensez que c'est une erreur, contactez l'administrateur.</p>
        <Link href="/" className="btn-primaire mt-4">Retour à l'accueil</Link>
      </div>
    </main>
  );
}
