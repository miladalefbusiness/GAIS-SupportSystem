import { ShieldAlert } from 'lucide-react';
import { redirect } from 'next/navigation';
import { DepartmentsManager } from '@/components/admin/DepartmentsManager';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getCurrentSession } from '@/src/core/auth/auth.ts';
import { hasPermission } from '@/src/core/auth/rbac.ts';
import { listAllDepartmentsAdmin } from '@/src/modules/departments/service.ts';
import { listOperatorsAdmin } from '@/src/modules/operators/service.ts';

export const dynamic = 'force-dynamic';

export default async function AdminDepartmentsPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/login');

  if (!hasPermission(session.access, 'admin:departments:manage')) {
    return (
      <Card className="border-red-200 bg-red-50/40">
        <CardHeader>
          <div className="flex items-center gap-2 text-red-800">
            <ShieldAlert className="h-5 w-5" />
            <CardTitle className="text-base">
              عدم دسترسی به مدیریت دپارتمان‌ها (۴۰۳)
            </CardTitle>
          </div>
          <CardDescription className="text-red-700">
            برای مدیریت دپارتمان‌ها نیاز به مجوز `admin:departments:manage` دارید.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const [departments, operators] = await Promise.all([
    listAllDepartmentsAdmin(),
    listOperatorsAdmin(),
  ]);

  const serializedDepartments = departments.map((d) => ({
    id: d.id,
    slug: d.slug,
    nameFa: d.nameFa,
    descriptionFa: d.descriptionFa,
    iconKey: d.iconKey,
    displayOrder: d.displayOrder,
    isActive: d.isActive,
    isPublic: d.isPublic,
    aiEnabled: d.aiEnabled,
    humanOperatorsAvailable: d.humanOperatorsAvailable,
    assignmentStrategy: d.assignmentStrategy,
    welcomeMessageFa: d.welcomeMessageFa,
    maxUploadSizeMb: d.maxUploadSizeMb,
    members: d.members,
  }));

  const simpleOperators = operators.map((o) => ({
    id: o.id,
    name: o.name,
    username: o.username,
    status: o.status,
    isAvailable: o.isAvailable,
  }));

  return (
    <DepartmentsManager
      initialDepartments={serializedDepartments}
      operators={simpleOperators}
    />
  );
}
