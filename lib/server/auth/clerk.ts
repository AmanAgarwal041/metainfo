// Sign-in runs on Clerk. The browser sends Clerk's short-lived session token
// as a Bearer header (or the __session cookie Clerk keeps fresh); route
// handlers verify it here. No Clerk middleware: OpenNext on Workers doesn't
// need one, and every route that cares asks for the session itself.

import { createClerkClient, verifyToken } from "@clerk/backend";
import type { Role } from "./accounts";

const env = (k: string) => process.env[k]?.trim() || "";

/** The server can verify sessions (secret key, or the PEM public key for networkless checks). */
export const clerkEnabled = () => !!(env("CLERK_SECRET_KEY") || env("CLERK_JWT_KEY"));

export interface ClerkAuth {
  userId: string;
  /** The active Clerk organisation, or null for the personal workspace. */
  orgId: string | null;
  orgRole: Role | null;
}

function tokenFrom(req: Request): string | null {
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (bearer) return bearer;
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === "__session") return v.join("=") || null;
  }
  return null;
}

/** Clerk's built-in roles are admin and member; a custom "owner" role is honoured, anything else is member. */
const appRole = (r: string | undefined): Role => {
  const name = (r ?? "").replace(/^org:/, "");
  return name === "owner" || name === "admin" ? name : "member";
};

/** The verified Clerk session behind a request, or null (anonymous, expired, or not set up). */
export async function clerkAuth(req: Request): Promise<ClerkAuth | null> {
  const token = tokenFrom(req);
  if (!token || !clerkEnabled()) return null;
  const parties = [new URL(req.url).origin, env("APP_URL").replace(/\/+$/, "")].filter(Boolean);
  try {
    const claims = await verifyToken(token, {
      secretKey: env("CLERK_SECRET_KEY") || undefined,
      jwtKey: env("CLERK_JWT_KEY") || undefined,
      authorizedParties: parties,
    });
    // A pending session still has a Clerk task to finish (e.g. choosing an organisation).
    if (!claims.sub || claims.sts === "pending") return null;
    const org = claims.v === 2 ? { id: claims.o?.id, rol: claims.o?.rol } : { id: claims.org_id, rol: claims.org_role };
    return { userId: claims.sub, orgId: org.id || null, orgRole: org.id ? appRole(org.rol) : null };
  } catch {
    return null;
  }
}

/** Verified addresses of a Clerk user (for carrying over workspaces from before Clerk). */
export async function verifiedEmails(userId: string): Promise<string[]> {
  if (!env("CLERK_SECRET_KEY")) return [];
  try {
    const user = await createClerkClient({ secretKey: env("CLERK_SECRET_KEY") }).users.getUser(userId);
    return user.emailAddresses.filter((e) => e.verification?.status === "verified").map((e) => e.emailAddress.trim().toLowerCase());
  } catch (e) {
    console.error("Couldn't read the Clerk user", e);
    return [];
  }
}
