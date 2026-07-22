import { and, eq } from "drizzle-orm";
import { closeDb, db, schema as s } from "./client.js";
import { auth } from "../auth/auth.js";
import { env } from "../config/env.js";

/**
 * Ensure the editorial admin exists and set its password WITHOUT touching
 * content. Unlike the seed (which wipes content tables and recreates the
 * user), this only creates the user/credential account when missing and
 * updates the password hash otherwise — safe to run against production.
 *
 * Reads the password from SEED_ADMIN_PASSWORD, hashed the same way sign-in
 * verifies it (better-auth's scrypt). Existing sessions stay valid; pass
 * --revoke-sessions to sign the admin out everywhere too.
 */

const ADMIN_EMAIL = "toimitus@rahaaon.fi";
const ADMIN_NAME = "Toimitus";

async function main() {
  const password = env.SEED_ADMIN_PASSWORD;
  if (!password) throw new Error("SEED_ADMIN_PASSWORD is not set (min 8 chars)");

  const ctx = await auth.$context;
  const passwordHash = await ctx.password.hash(password);

  const [existing] = await db
    .select({ id: s.user.id })
    .from(s.user)
    .where(eq(s.user.email, ADMIN_EMAIL));

  let adminId: string;
  let action: string;
  if (existing) {
    adminId = existing.id;
    action = "updated password for";
  } else {
    // Public sign-up is disabled, so go through better-auth's internal
    // adapter — same as the seed.
    const created = await ctx.internalAdapter.createUser({
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      emailVerified: true,
    });
    adminId = created.id;
    action = "created user";
  }

  const updated = await db
    .update(s.account)
    .set({ password: passwordHash, updatedAt: new Date() })
    .where(and(eq(s.account.userId, adminId), eq(s.account.providerId, "credential")))
    .returning({ id: s.account.id });

  if (updated.length === 0) {
    await ctx.internalAdapter.linkAccount({
      userId: adminId,
      providerId: "credential",
      accountId: adminId,
      password: passwordHash,
    });
    if (existing) action = "added credential account for";
  }

  let revoked = 0;
  if (process.argv.includes("--revoke-sessions")) {
    const gone = await db
      .delete(s.session)
      .where(eq(s.session.userId, adminId))
      .returning({ id: s.session.id });
    revoked = gone.length;
  }

  console.log(`[set-admin-password] ${action} ${ADMIN_EMAIL}`, { revoked });
}

main()
  .then(() => closeDb())
  .catch((err: unknown) => {
    console.error("[set-admin-password] failed:", err);
    void closeDb().finally(() => process.exit(1));
  });
