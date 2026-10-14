import { NextRequest, NextResponse } from "next/server";
import { orgDetails, renameOrg } from "@/lib/server/auth/accounts";
import { handle, requireOrg } from "@/lib/server/auth/session";

export const dynamic = "force-dynamic";

/** GET /api/org → the active organisation, its members and pending invites. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const s = await requireOrg(req);
    return NextResponse.json({ ...(await orgDetails(s.db, s.org.id)), role: s.org.role, me: s.user.id });
  });
}

/** PATCH /api/org {name} (admin) → rename. */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const s = await requireOrg(req, "admin");
    const { name } = (await req.json().catch(() => ({}))) as { name?: string };
    await renameOrg(s.db, s.org.id, name);
    return NextResponse.json({ ok: true });
  });
}
