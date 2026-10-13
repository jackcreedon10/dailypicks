import { authPlayer } from "@/lib/auth";
import { body, handle, json } from "@/lib/http";
import { logEvent } from "@/lib/mystery";

/** Funnel tracking: the browser reports open / start / finish once per puzzle day. Always answers ok. */
export const POST = handle(async (req: Request) => {
  const b = await body(req);
  try {
    const me = await authPlayer(req);
    await logEvent(String(b.date ?? ""), b.device, b.kind, me?.id ?? null);
  } catch (e) {
    console.warn("mystery event:", (e as Error).message);
  }
  return json({ ok: true });
});
