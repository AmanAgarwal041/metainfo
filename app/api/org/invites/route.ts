import { NextRequest, NextResponse } from "next/server";
import { createInvite, type Role } from "@/lib/server/auth/accounts";
import { appUrl } from "@/lib/server/auth/providers";
import { handle, requireOrg } from "@/lib/server/auth/session";

/** POST {email, role} (admin) → an invite link to share. Only the invited email can accept it. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const s = await requireOrg(req, "admin");
    const { email, role } = (await req.json().catch(() => ({}))) as { email?: string; role?: Role };
    const { id, token } = await createInvite(s.db, s.org.id, s.org.role, s.user.id, email, role ?? "member");
    return NextResponse.json({ id, link: `${appUrl(req)}/invite/${token}` });
  });
}
