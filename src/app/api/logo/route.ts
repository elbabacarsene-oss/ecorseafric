import { db } from "@/lib/db";

export async function GET() {
  const e = await db.entreprise.findUnique({ where: { id: 1 }, select: { logo: true, logoMime: true, updatedAt: true } });
  if (!e?.logo || !e.logoMime) return new Response("Aucun logo", { status: 404 });
  return new Response(new Uint8Array(e.logo), {
    headers: { "Content-Type": e.logoMime, "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" },
  });
}
