import { redirect } from "next/navigation";

export default function PageClients() {
  redirect("/intervenants?categorie=MAITRISE_OUVRAGE");
}
