import { NextRequest, NextResponse } from "next/server";
import { revokeInvite } from "@/lib/server/auth/accounts";
import { handle, requireOrg } from "@/lib/server/auth/session";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const s = await requireOrg(req, "admin");
    await revokeInvite(s.db, s.org.id, (await params).id);
    return NextResponse.json({ ok: true });
  });
}
