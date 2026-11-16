import { ShieldAlert } from 'lucide-react';
import { redirect } from 'next/navigation';
import { AiSettingsManager } from '@/components/admin/AiSettingsManager';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getCurrentSession } from '@/src/core/auth/auth.ts';
import { hasPermission } from '@/src/core/auth/rbac.ts';
import {
  getSafeAiProviderSettings,
  listAllDepartmentAiConfigsAdmin,
} from '@/src/modules/ai/settings.ts';
import { listKnowledgeCollectionsAdmin } from '@/src/modules/knowledge/service.ts';

export const dynamic = 'force-dynamic';

export default async function AdminAiSettingsPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/login');

  if (!hasPermission(session.access, 'ai:settings:manage')) {
    return (
      <Card className="border-red-200 bg-red-50/40">
        <CardHeader>
          <div className="flex items-center gap-2 text-red-800">
            <ShieldAlert className="h-5 w-5" />
            <CardTitle className="text-base">
              عدم دسترسی به تنظیمات هوش مصنوعی (۴۰۳)
            </CardTitle>
          </div>
          <CardDescription className="text-red-700">
            برای مدیریت تنظیمات ارائه‌دهنده و کلیدهای هوش مصنوعی نیاز به مجوز `ai:settings:manage` دارید.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const [provider, departmentConfigs, collections] = await Promise.all([
    getSafeAiProviderSettings(),
    listAllDepartmentAiConfigsAdmin(),
    listKnowledgeCollectionsAdmin(),
  ]);

  return (
    <AiSettingsManager
      initialProvider={provider}
      initialDepartments={departmentConfigs}
      collections={collections.map((c) => ({
        id: c.id,
        nameFa: c.nameFa,
        scope: c.scope,
        isActive: c.isActive,
      }))}
    />
  );
}
