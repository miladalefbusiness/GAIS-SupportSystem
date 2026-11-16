import { eq } from 'drizzle-orm';
import { recordAuditLog } from '@/src/core/audit/audit.ts';
import { db } from '@/src/db/index.ts';
import { systemSettings } from '@/src/db/schema.ts';
import {
  DEFAULT_PLATFORM_SETTINGS,
  PLATFORM_SETTINGS_KEY,
  platformSettingsSchema,
  THEME_ACCENT_OPTIONS,
  type PlatformSettingsDto,
  type ThemeAccentPreset,
} from './settings-schema.ts';

export {
  DEFAULT_PLATFORM_SETTINGS,
  PLATFORM_SETTINGS_KEY,
  platformSettingsSchema,
  THEME_ACCENT_OPTIONS,
  type PlatformSettingsDto,
  type ThemeAccentPreset,
};

export async function getPlatformSettings(): Promise<{
  settings: PlatformSettingsDto;
  updatedAt: string | null;
}> {
  try {
    const row = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.key, PLATFORM_SETTINGS_KEY),
    });
    if (!row || !row.valueJson) {
      return { settings: DEFAULT_PLATFORM_SETTINGS, updatedAt: null };
    }
    const parsed = platformSettingsSchema.safeParse({
      ...DEFAULT_PLATFORM_SETTINGS,
      ...row.valueJson,
    });
    return {
      settings: parsed.success ? parsed.data : DEFAULT_PLATFORM_SETTINGS,
      updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    };
  } catch {
    return { settings: DEFAULT_PLATFORM_SETTINGS, updatedAt: null };
  }
}

export async function updatePlatformSettings(params: {
  actorUserId: string;
  input: PlatformSettingsDto;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<{ settings: PlatformSettingsDto; updatedAt: string }> {
  const validated = platformSettingsSchema.parse(params.input);
  const now = new Date();

  await db
    .insert(systemSettings)
    .values({
      key: PLATFORM_SETTINGS_KEY,
      valueJson: validated as unknown as Record<string, unknown>,
      isSensitive: false,
      updatedBy: params.actorUserId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: {
        valueJson: validated as unknown as Record<string, unknown>,
        updatedBy: params.actorUserId,
        updatedAt: now,
      },
    });

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'admin.settings.updated',
    targetType: 'system_setting',
    targetId: PLATFORM_SETTINGS_KEY,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: {
      brandNameFa: validated.brandNameFa,
      defaultTicketPriority: validated.defaultTicketPriority,
      customerOtpTtlMinutes: validated.customerOtpTtlMinutes,
      themeAccent: validated.themeAccent,
      hasMaintenanceNotice: Boolean(validated.maintenanceNoticeFa),
    },
  });

  return {
    settings: validated,
    updatedAt: now.toISOString(),
  };
}
