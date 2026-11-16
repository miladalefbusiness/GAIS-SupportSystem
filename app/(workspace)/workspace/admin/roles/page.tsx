import { ShieldAlert } from 'lucide-react';
import { redirect } from 'next/navigation';
import { RolesManager } from '@/components/admin/RolesManager';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getCurrentSession } from '@/src/core/auth/auth.ts';
import { hasPermission } from '@/src/core/auth/rbac.ts';
import { listRolesAndPermissionsAdmin } from '@/src/modules/roles/service.ts';

export const dynamic = 'force-dynamic';

export default async function AdminRolesPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/login');

  if (!hasPermission(session.access, 'admin:roles:manage')) {
    return (
      <Card className="border-red-200 bg-red-50/40">
        <CardHeader>
          <div className="flex items-center gap-2 text-red-800">
            <ShieldAlert className="h-5 w-5" />
            <CardTitle className="text-base">
              عدم دسترسی به مدیریت نقش‌ها و مجوزها (۴۰۳)
            </CardTitle>
          </div>
          <CardDescription className="text-red-700">
            برای مدیریت نقش‌ها و مجوزها نیاز به مجوز `admin:roles:manage` دارید.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const data = await listRolesAndPermissionsAdmin();

  const serializedRoles = data.roles.map((r) => ({
    id: r.id,
    slug: r.slug,
    nameFa: r.nameFa,
    descriptionFa: r.descriptionFa ?? '',
    isSystem: r.isSystem,
    permissionIds: r.permissionIds,
  }));

  const serializedPerms = data.permissions.map((p) => ({
    id: p.id,
    key: p.key,
    module: p.module,
    nameFa: p.nameFa,
    descriptionFa: p.descriptionFa ?? '',
  }));

  return (
    <RolesManager initialRoles={serializedRoles} permissions={serializedPerms} />
  );
}
