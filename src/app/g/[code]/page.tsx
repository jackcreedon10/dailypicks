import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Game, type Invite } from "@/components/Game";
import { db } from "@/lib/db";
import { sharedPicks } from "@/lib/game";

type Props = { params: Promise<{ code: string }>; searchParams: Promise<{ p?: string }> };

async function loadInvite({ params, searchParams }: Props): Promise<Invite | null> {
  const { code } = await params;
  if (!/^[a-z0-9]{4,12}$/.test(code)) return null;
  const { data } = await db()
    .from("groups")
    .select("code, name, players!groups_created_by_fkey(nickname)")
    .eq("code", code)
    .maybeSingle();
  if (!data) return null;
  const creator = data.players as unknown as { nickname: string } | null;

  // ?p=<player id> is whoever shared the link; show their picks.
  const p = (await searchParams).p;
  const picks = p && /^[0-9a-f-]{36}$/.test(p) ? await sharedPicks(p) : null;
  return {
    code: data.code as string,
    name: data.name as string,
    createdBy: creator?.nickname ?? null,
    sharer: picks ? { ...picks, id: p! } : null,
  };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const invite = await loadInvite(props);
  if (!invite) return { title: "Daily Picks" };
  const s = invite.sharer;
  const title = s?.symbols.length
    ? `${s.nickname}'s picks: ${s.symbols.map((sym, i) => `${sym} $${Math.round(s.allocs[i] / 1000)}k`).join(", ")}`
    : invite.createdBy
      ? `${invite.createdBy} challenged you on Daily Picks`
      : `Join ${invite.name} on Daily Picks`;
  const description = "Pick 3 stocks, split $100,000 between them, and see who wins at the close.";
  return { title, description, openGraph: { title, description } };
}

export default async function InvitePage(props: Props) {
  const invite = await loadInvite(props);
  if (!invite) notFound();
  return <Game invite={invite} />;
}
