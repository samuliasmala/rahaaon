import { and, eq } from "drizzle-orm";
import { closeDb, db, schema as s } from "./client.js";
import { auth } from "../auth/auth.js";
import { env } from "../config/env.js";

/**
 * Rotate the editorial admin's password WITHOUT touching content. Unlike the
 * seed (which wipes content tables and recreates the user), this updates only
 * the credential account's password hash — safe to run against production.
 *
 * Reads the new password from SEED_ADMIN_PASSWORD, hashed the same way sign-in
 * verifies it (better-auth's scrypt). Existing sessions stay valid; pass
 * --revoke-sessions to sign the admin out everywhere too.
 */

const ADMIN_EMAIL = "toimitus@rahaaon.fi";

async function main() {
  const password = env.SEED_ADMIN_PASSWORD;
  if (!password) throw new Error("SEED_ADMIN_PASSWORD is not set (min 8 chars)");

  const [admin] = await db.select().from(s.user).where(eq(s.user.email, ADMIN_EMAIL));
  if (!admin) throw new Error(`No user with email ${ADMIN_EMAIL}`);

  const ctx = await auth.$context;
  const passwordHash = await ctx.password.hash(password);

  const updated = await db
    .update(s.account)
    .set({ password: passwordHash, updatedAt: new Date() })
    .where(and(eq(s.account.userId, admin.id), eq(s.account.providerId, "credential")))
    .returning({ id: s.account.id });

  if (updated.length === 0) {
    throw new Error(`No credential account for ${ADMIN_EMAIL} — nothing to update`);
  }

  let revoked = 0;
  if (process.argv.includes("--revoke-sessions")) {
    const gone = await db
      .delete(s.session)
      .where(eq(s.session.userId, admin.id))
      .returning({ id: s.session.id });
    revoked = gone.length;
  }

  console.log(`[set-admin-password] updated password for ${ADMIN_EMAIL}`, { revoked });
}

main()
  .then(() => closeDb())
  .catch((err: unknown) => {
    console.error("[set-admin-password] failed:", err);
    void closeDb().finally(() => process.exit(1));
  });
