import { ShieldAlert } from 'lucide-react';
import { redirect } from 'next/navigation';
import { KnowledgeBaseManager } from '@/components/admin/KnowledgeBaseManager';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getCurrentSession } from '@/src/core/auth/auth.ts';
import { hasPermission } from '@/src/core/auth/rbac.ts';
import { listAllDepartmentsAdmin } from '@/src/modules/departments/service.ts';
import {
  listKnowledgeCollectionsAdmin,
  listKnowledgeDocumentsAdmin,
  listQaEntriesAdmin,
} from '@/src/modules/knowledge/service.ts';

export const dynamic = 'force-dynamic';

export default async function AdminKnowledgePage() {
  const session = await getCurrentSession();
  if (!session) redirect('/login');

  const canAccess =
    hasPermission(session.access, 'kb:workspace:access') ||
    hasPermission(session.access, 'kb:entries:manage');

  if (!canAccess) {
    return (
      <Card className="border-red-200 bg-red-50/40">
        <CardHeader>
          <div className="flex items-center gap-2 text-red-800">
            <ShieldAlert className="h-5 w-5" />
            <CardTitle className="text-base">
              عدم دسترسی به مخزن دانش سازمانی (۴۰۳)
            </CardTitle>
          </div>
          <CardDescription className="text-red-700">
            برای مشاهده یا مدیریت مخزن دانش به مجوز `kb:workspace:access` یا `kb:entries:manage` نیاز دارید.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const canManage = hasPermission(session.access, 'kb:entries:manage');

  const [collections, documents, qaEntries, departments] = await Promise.all([
    listKnowledgeCollectionsAdmin(),
    listKnowledgeDocumentsAdmin(),
    listQaEntriesAdmin(),
    listAllDepartmentsAdmin(),
  ]);

  return (
    <KnowledgeBaseManager
      initialCollections={collections.map((c) => ({
        id: c.id,
        slug: c.slug,
        nameFa: c.nameFa,
        descriptionFa: c.descriptionFa,
        scope: c.scope,
        isActive: c.isActive,
        departments: c.departments,
      }))}
      initialDocuments={documents}
      initialQaEntries={qaEntries}
      departments={departments.map((d) => ({
        id: d.id,
        nameFa: d.nameFa,
        slug: d.slug,
      }))}
      canManage={canManage}
    />
  );
}
