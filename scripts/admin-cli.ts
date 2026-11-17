import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { recordAuditLog } from '../src/core/audit/audit.ts';
import { encryptSensitiveValue } from '../src/core/security/crypto.ts';
import { db, pool } from '../src/db/index.ts';
import {
  aiProviderSettings,
  authAccounts,
  authSessions,
  roles,
  userRoles,
  users,
} from '../src/db/schema.ts';

function validatePasswordPolicy(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (password.length < 10) errors.push('Password must be at least 10 characters.');
  if (password.length > 128) errors.push('Password must not exceed 128 characters.');
  if (!/[A-Za-z]/.test(password)) errors.push('Password must include at least one ASCII letter.');
  if (!/[0-9]/.test(password)) errors.push('Password must include at least one digit.');
  return { valid: errors.length === 0, errors };
}

function parseArgs(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(token);
    }
  }
  return { command: positional[0] || 'help', flags, positional };
}

function generateSecurePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  const bytes = randomBytes(18);
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += chars[bytes[i] % chars.length];
  }
  // Guarantee policy compliance (uppercase, lowercase, digit, symbol)
  return `${out}A1!a`;
}

async function readPasswordFromStdinOrFlag(
  flags: Record<string, string | boolean>
): Promise<{ password: string; generated: boolean }> {
  if (flags['generate-password']) {
    return { password: generateSecurePassword(), generated: true };
  }
  if (typeof flags.password === 'string' && flags.password.length > 0) {
    return { password: flags.password, generated: false };
  }
  if (flags['password-stdin']) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
    if (!raw) throw new Error('No password provided on stdin.');
    return { password: raw, generated: false };
  }
  throw new Error('Password is required (--password-stdin or --generate-password).');
}

async function cmdList(jsonOutput: boolean) {
  const [userRows, userRoleRows] = await Promise.all([
    db
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        email: users.email,
        status: users.status,
        mustChangePassword: users.mustChangePassword,
        isBootstrapAdmin: users.isBootstrapAdmin,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(asc(users.createdAt)),
    db
      .select({
        userId: userRoles.userId,
        slug: roles.slug,
        nameFa: roles.nameFa,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id)),
  ]);

  const roleMap = new Map<string, string[]>();
  for (const r of userRoleRows) {
    const list = roleMap.get(r.userId) || [];
    list.push(r.slug);
    roleMap.set(r.userId, list);
  }

  const sanitized = userRows.map((u) => ({
    id: u.id,
    username: u.username,
    name: u.name,
    email: u.email,
    status: u.status,
    mustChangePassword: u.mustChangePassword,
    isBootstrapAdmin: u.isBootstrapAdmin,
    roles: roleMap.get(u.id) || [],
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  }));

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(sanitized, null, 2)}\n`);
    return;
  }

  if (sanitized.length === 0) {
    console.log('No administrator or staff accounts found.');
    return;
  }

  console.log('USERNAME\tSTATUS\tROLES\tFORCE_PWD_CHANGE\tEMAIL\tNAME');
  for (const u of sanitized) {
    console.log(
      `${u.username}\t${u.status}\t${u.roles.join(',') || 'none'}\t${u.mustChangePassword}\t${u.email}\t${u.name}`
    );
  }
}

async function cmdCreate(flags: Record<string, string | boolean>) {
  const username = String(flags.username || '').trim().toLowerCase();
  const email = String(flags.email || '').trim().toLowerCase();
  const name = String(flags.name || username).trim();
  const roleSlug = String(flags.role || 'super_admin').trim();
  const mustChangePassword = Boolean(flags['must-change-password']);

  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    throw new Error('Invalid username (3-40 lowercase alphanumeric, ., _, -).');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Invalid email address.');
  }

  const { password, generated } = await readPasswordFromStdinOrFlag(flags);
  const policy = validatePasswordPolicy(password);
  if (!policy.valid) {
    throw new Error(policy.errors.join(' '));
  }

  const roleRow = await db.query.roles.findFirst({
    where: eq(roles.slug, roleSlug),
  });
  if (!roleRow) {
    throw new Error(`Role '${roleSlug}' not found. Run database migrations & bootstrap first.`);
  }

  const existing = await db.query.users.findFirst({
    where: eq(users.username, username),
  });
  if (existing) {
    throw new Error(`User '${username}' already exists.`);
  }

  const existingEmail = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (existingEmail) {
    throw new Error(`Email '${email}' is already in use.`);
  }

  const userId = randomUUID();
  const passwordHash = await hashPassword(password);

  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: userId,
      username,
      displayUsername: username,
      email,
      emailVerified: true,
      name,
      status: 'active',
      mustChangePassword,
      isBootstrapAdmin: false,
    });

    await tx.insert(authAccounts).values({
      id: randomUUID(),
      accountId: userId,
      providerId: 'credential',
      userId,
      password: passwordHash,
    });

    await tx.insert(userRoles).values({
      userId,
      roleId: roleRow.id,
    });
  });

  await recordAuditLog({
    actorUserId: userId,
    actorType: 'system',
    action: 'admin.cli.user_created',
    targetType: 'user',
    targetId: userId,
    metadata: { username, roleSlug, mustChangePassword },
  });

  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, userId, username, role: roleSlug, generatedPassword: generated ? password : null })}\n`
    );
  } else {
    console.log(`[admin-cli] Created account '${username}' with role '${roleSlug}'.`);
    if (generated) {
      console.log(`[admin-cli] Generated one-time password (save securely, shown once): ${password}`);
    }
  }
}

async function cmdResetPassword(flags: Record<string, string | boolean>) {
  const username = String(flags.username || '').trim().toLowerCase();
  if (!username) throw new Error('--username is required.');

  const userRow = await db.query.users.findFirst({
    where: eq(users.username, username),
  });
  if (!userRow) throw new Error(`User '${username}' not found.`);

  const { password, generated } = await readPasswordFromStdinOrFlag(flags);
  const policy = validatePasswordPolicy(password);
  if (!policy.valid) {
    throw new Error(policy.errors.join(' '));
  }

  const passwordHash = await hashPassword(password);
  const forceChange = Boolean(flags['force-change']);

  await db.transaction(async (tx) => {
    const existingAccount = await tx.query.authAccounts.findFirst({
      where: and(
        eq(authAccounts.userId, userRow.id),
        eq(authAccounts.providerId, 'credential')
      ),
    });

    if (existingAccount) {
      await tx
        .update(authAccounts)
        .set({ password: passwordHash, updatedAt: new Date() })
        .where(eq(authAccounts.id, existingAccount.id));
    } else {
      await tx.insert(authAccounts).values({
        id: randomUUID(),
        accountId: userRow.id,
        providerId: 'credential',
        userId: userRow.id,
        password: passwordHash,
      });
    }

    if (forceChange) {
      await tx
        .update(users)
        .set({ mustChangePassword: true, updatedAt: new Date() })
        .where(eq(users.id, userRow.id));
    }

    // Revoke all active sessions so old compromised sessions cannot remain logged in
    await tx.delete(authSessions).where(eq(authSessions.userId, userRow.id));
  });

  await recordAuditLog({
    actorType: 'system',
    action: 'admin.cli.password_reset',
    targetType: 'user',
    targetId: userRow.id,
    metadata: { username, forceChange, sessionsRevoked: true },
  });

  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, username, sessionsRevoked: true, generatedPassword: generated ? password : null })}\n`
    );
  } else {
    console.log(`[admin-cli] Password reset for '${username}' and active sessions revoked.`);
    if (generated) {
      console.log(`[admin-cli] Generated one-time password (shown once): ${password}`);
    }
  }
}

async function cmdSetStatus(
  usernameRaw: string,
  targetStatus: 'active' | 'suspended',
  allowLastSuperAdmin: boolean
) {
  const username = usernameRaw.trim().toLowerCase();
  if (!username) throw new Error('--username is required.');

  const userRow = await db.query.users.findFirst({
    where: eq(users.username, username),
  });
  if (!userRow) throw new Error(`User '${username}' not found.`);

  if (targetStatus === 'suspended' && !allowLastSuperAdmin) {
    const superAdminRole = await db.query.roles.findFirst({
      where: eq(roles.slug, 'super_admin'),
    });
    if (superAdminRole) {
      const superAdmins = await db
        .select({ id: users.id, status: users.status })
        .from(userRoles)
        .innerJoin(users, eq(userRoles.userId, users.id))
        .where(eq(userRoles.roleId, superAdminRole.id));
      const activeSuperAdmins = superAdmins.filter((sa) => sa.status === 'active');
      if (
        activeSuperAdmins.length === 1 &&
        activeSuperAdmins[0].id === userRow.id
      ) {
        throw new Error(
          'Refusing to disable the last active Super Admin account (use --force to override).'
        );
      }
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ status: targetStatus, updatedAt: new Date() })
      .where(eq(users.id, userRow.id));

    if (targetStatus === 'suspended') {
      await tx.delete(authSessions).where(eq(authSessions.userId, userRow.id));
    }
  });

  await recordAuditLog({
    actorType: 'system',
    action: targetStatus === 'active' ? 'admin.cli.user_enabled' : 'admin.cli.user_disabled',
    targetType: 'user',
    targetId: userRow.id,
    metadata: { username, status: targetStatus },
  });

  console.log(
    `[admin-cli] Account '${username}' status updated to '${targetStatus}'${
      targetStatus === 'suspended' ? ' (active sessions revoked)' : ''
    }.`
  );
}

async function cmdForcePasswordChange(usernameRaw: string) {
  const username = usernameRaw.trim().toLowerCase();
  if (!username) throw new Error('--username is required.');

  const userRow = await db.query.users.findFirst({
    where: eq(users.username, username),
  });
  if (!userRow) throw new Error(`User '${username}' not found.`);

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ mustChangePassword: true, updatedAt: new Date() })
      .where(eq(users.id, userRow.id));
    await tx.delete(authSessions).where(eq(authSessions.userId, userRow.id));
  });

  await recordAuditLog({
    actorType: 'system',
    action: 'admin.cli.force_password_change',
    targetType: 'user',
    targetId: userRow.id,
    metadata: { username },
  });

  console.log(`[admin-cli] '${username}' must change password on next login; sessions revoked.`);
}

async function cmdUpdate(flags: Record<string, string | boolean>) {
  const currentUsername = String(flags.username || '').trim().toLowerCase();
  if (!currentUsername) throw new Error('--username is required.');

  const userRow = await db.query.users.findFirst({
    where: eq(users.username, currentUsername),
  });
  if (!userRow) throw new Error(`User '${currentUsername}' not found.`);

  const newUsername =
    typeof flags['new-username'] === 'string' && flags['new-username'].trim()
      ? flags['new-username'].trim().toLowerCase()
      : null;
  const newEmail =
    typeof flags.email === 'string' && flags.email.trim()
      ? flags.email.trim().toLowerCase()
      : null;
  const newName =
    typeof flags.name === 'string' && flags.name.trim()
      ? flags.name.trim()
      : null;

  const hasPasswordUpdate = Boolean(
    flags['password-stdin'] ||
      flags['generate-password'] ||
      (typeof flags.password === 'string' && flags.password.length > 0)
  );

  if (newUsername && newUsername !== currentUsername) {
    if (!/^[a-z0-9._-]{3,40}$/.test(newUsername)) {
      throw new Error('Invalid --new-username (3-40 lowercase alphanumeric, ., _, -).');
    }
    const taken = await db.query.users.findFirst({
      where: eq(users.username, newUsername),
    });
    if (taken) throw new Error(`Username '${newUsername}' is already in use.`);
  }

  if (newEmail && newEmail !== userRow.email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      throw new Error('Invalid --email address.');
    }
    const takenEmail = await db.query.users.findFirst({
      where: eq(users.email, newEmail),
    });
    if (takenEmail) throw new Error(`Email '${newEmail}' is already in use.`);
  }

  let newPasswordHash: string | null = null;
  let generatedPassword: string | null = null;
  if (hasPasswordUpdate) {
    const { password, generated } = await readPasswordFromStdinOrFlag(flags);
    const policy = validatePasswordPolicy(password);
    if (!policy.valid) {
      throw new Error(policy.errors.join(' '));
    }
    newPasswordHash = await hashPassword(password);
    if (generated) generatedPassword = password;
  }

  const forceChange = Boolean(flags['force-change']);
  const revokeSessions = Boolean(
    (newUsername && newUsername !== currentUsername) || newPasswordHash || forceChange
  );

  const userPatch: Partial<typeof users.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (newUsername && newUsername !== currentUsername) {
    userPatch.username = newUsername;
    userPatch.displayUsername = newUsername;
  }
  if (newEmail && newEmail !== userRow.email) {
    userPatch.email = newEmail;
  }
  if (newName && newName !== userRow.name) {
    userPatch.name = newName;
  }
  if (forceChange) {
    userPatch.mustChangePassword = true;
  }

  await db.transaction(async (tx) => {
    await tx.update(users).set(userPatch).where(eq(users.id, userRow.id));

    if (newPasswordHash) {
      const existingAccount = await tx.query.authAccounts.findFirst({
        where: and(
          eq(authAccounts.userId, userRow.id),
          eq(authAccounts.providerId, 'credential')
        ),
      });
      if (existingAccount) {
        await tx
          .update(authAccounts)
          .set({ password: newPasswordHash, updatedAt: new Date() })
          .where(eq(authAccounts.id, existingAccount.id));
      } else {
        await tx.insert(authAccounts).values({
          id: randomUUID(),
          accountId: userRow.id,
          providerId: 'credential',
          userId: userRow.id,
          password: newPasswordHash,
        });
      }
    }

    if (revokeSessions) {
      await tx.delete(authSessions).where(eq(authSessions.userId, userRow.id));
    }
  });

  await recordAuditLog({
    actorType: 'system',
    action: 'admin.cli.user_updated',
    targetType: 'user',
    targetId: userRow.id,
    metadata: {
      previousUsername: currentUsername,
      username: newUsername || currentUsername,
      emailChanged: Boolean(newEmail && newEmail !== userRow.email),
      nameChanged: Boolean(newName && newName !== userRow.name),
      passwordChanged: Boolean(newPasswordHash),
      forceChange,
      sessionsRevoked: revokeSessions,
    },
  });

  const finalUsername = newUsername || currentUsername;
  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        userId: userRow.id,
        username: finalUsername,
        email: newEmail || userRow.email,
        name: newName || userRow.name,
        sessionsRevoked: revokeSessions,
        generatedPassword,
      })}\n`
    );
  } else {
    console.log(
      `[admin-cli] Updated account '${finalUsername}'${
        revokeSessions ? ' (active sessions revoked)' : ''
      }.`
    );
    if (generatedPassword) {
      console.log(
        `[admin-cli] Generated one-time password (shown once): ${generatedPassword}`
      );
    }
  }
}

async function cmdAiSync(flags: Record<string, string | boolean>) {
  const baseUrl = process.env.AI_BASE_URL?.trim() || null;
  const apiKey =
    process.env.AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || null;
  const chatModel = process.env.AI_CHAT_MODEL?.trim() || (baseUrl ? 'gpt-4o-mini' : 'gemini-4-hydrogen');
  const embeddingModel = process.env.AI_EMBEDDING_MODEL?.trim() || null;

  if (!apiKey && !baseUrl) {
    console.log('[admin-cli] No AI provider environment settings configured; skipping.');
    return;
  }

  const existing = await db.query.aiProviderSettings.findFirst({
    where: eq(aiProviderSettings.id, 'default'),
  });
  if (existing && !flags.overwrite) {
    console.log('[admin-cli] AI provider settings already configured in database; preserving.');
    return;
  }

  const encMaterial = process.env.APP_ENCRYPTION_KEY;
  if (!encMaterial || encMaterial.length < 32) {
    throw new Error('APP_ENCRYPTION_KEY is required to encrypt AI API key.');
  }

  const encryptedApiKey = apiKey ? encryptSensitiveValue(apiKey, encMaterial) : null;
  const apiKeyHint =
    apiKey && apiKey.length > 8
      ? `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}`
      : apiKey
      ? '••••••••'
      : null;

  const providerType = baseUrl ? 'openai_compatible' : 'gemini';
  const providerName = baseUrl ? 'OpenAI-Compatible API' : 'Google Gemini';

  if (existing) {
    await db
      .update(aiProviderSettings)
      .set({
        providerType,
        providerName,
        baseUrl,
        ...(encryptedApiKey ? { encryptedApiKey, apiKeyHint } : {}),
        chatModel,
        embeddingModel,
        globalEnabled: Boolean(apiKey || existing.encryptedApiKey),
        updatedAt: new Date(),
      })
      .where(eq(aiProviderSettings.id, 'default'));
  } else {
    await db.insert(aiProviderSettings).values({
      id: 'default',
      providerType,
      providerName,
      baseUrl,
      encryptedApiKey,
      apiKeyHint,
      chatModel,
      embeddingModel,
      globalEnabled: Boolean(apiKey),
    });
  }

  // Ensure standard roles/permissions list was not disrupted
  const roleSlugs = await db.select({ slug: roles.slug }).from(roles).where(inArray(roles.slug, ['super_admin']));
  if (roleSlugs.length === 0) {
    console.log('[admin-cli] Note: RBAC roles not bootstrapped yet.');
  }
  console.log('[admin-cli] AI provider settings synchronized cleanly (secret encrypted).');
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  switch (command) {
    case 'list':
      await cmdList(Boolean(flags.json));
      break;
    case 'create':
      await cmdCreate(flags);
      break;
    case 'reset-password':
      await cmdResetPassword(flags);
      break;
    case 'disable':
      await cmdSetStatus(String(flags.username || ''), 'suspended', Boolean(flags.force));
      break;
    case 'enable':
      await cmdSetStatus(String(flags.username || ''), 'active', true);
      break;
    case 'force-password-change':
      await cmdForcePasswordChange(String(flags.username || ''));
      break;
    case 'update':
      await cmdUpdate(flags);
      break;
    case 'ai-sync':
      await cmdAiSync(flags);
      break;
    default:
      console.log(
        [
          'Usage: admin-cli.ts <command> [options]',
          '  list [--json]',
          '  create --username <user> --email <mail> [--name <full>] [--role super_admin|dept_manager|operator|file_operator|viewer] (--password-stdin | --generate-password) [--must-change-password]',
          '  update --username <user> [--new-username <user>] [--email <mail>] [--name <full>] [--password-stdin | --generate-password] [--force-change]',
          '  reset-password --username <user> (--password-stdin | --generate-password) [--force-change]',
          '  disable --username <user> [--force]',
          '  enable --username <user>',
          '  force-password-change --username <user>',
          '  ai-sync [--overwrite]',
        ].join('\n')
      );
      if (command !== 'help') process.exitCode = 1;
      break;
  }
}

main()
  .catch((err) => {
    console.error('[admin-cli] Error:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
