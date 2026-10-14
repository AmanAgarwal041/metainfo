import { NextRequest, NextResponse } from "next/server";
import { changeRole, removeMember, type Role } from "@/lib/server/auth/accounts";
import { handle, requireOrg } from "@/lib/server/auth/session";

/** PATCH {role} (admin; owners only for owner changes) */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const s = await requireOrg(req, "admin");
    const { role } = (await req.json().catch(() => ({}))) as { role?: Role };
    await changeRole(s.db, s.org.id, s.org.role, (await params).id, role as Role);
    return NextResponse.json({ ok: true });
  });
}

/** DELETE → remove a member (admins), or leave (anyone, removing themselves). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const s = await requireOrg(req);
    await removeMember(s.db, s.org.id, s.org.role, s.user.id, (await params).id);
    return NextResponse.json({ ok: true });
  });
}
