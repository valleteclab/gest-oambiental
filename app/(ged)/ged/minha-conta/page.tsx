import { redirect } from "next/navigation";
import { exigirGed } from "@/lib/ged/escopo";

export const dynamic = "force-dynamic";

export default async function MinhaConta() {
  await exigirGed();
  redirect("/ged/minha-conta/notificacoes");
}
