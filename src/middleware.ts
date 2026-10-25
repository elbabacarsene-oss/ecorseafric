import { NextResponse, type NextRequest } from "next/server";

// Filtre rapide : sans cookie de session, on renvoie vers la connexion.
// La vérification réelle (session en base, rôle, périmètre) est faite sur chaque page et action serveur.
const PUBLIC = ["/connexion", "/api/logo", "/favicon.ico"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (!req.cookies.get("ecorse_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/connexion";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
