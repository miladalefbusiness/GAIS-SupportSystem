import { ShieldAlert } from 'lucide-react';
import { redirect } from 'next/navigation';
import { OperatorsManager } from '@/components/admin/OperatorsManager';
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
import { listRolesAndPermissionsAdmin } from '@/src/modules/roles/service.ts';

export const dynamic = 'force-dynamic';

export default async function AdminOperatorsPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/login');

  if (!hasPermission(session.access, 'admin:users:manage')) {
    return (
      <Card className="border-red-200 bg-red-50/40">
        <CardHeader>
          <div className="flex items-center gap-2 text-red-800">
            <ShieldAlert className="h-5 w-5" />
            <CardTitle className="text-base">
              عدم دسترسی به مدیریت اپراتورها (۴۰۳)
            </CardTitle>
          </div>
          <CardDescription className="text-red-700">
            برای مدیریت حساب اپراتورها نیاز به مجوز `admin:users:manage` دارید.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const [operators, roleData, departments] = await Promise.all([
    listOperatorsAdmin(),
    listRolesAndPermissionsAdmin(),
    listAllDepartmentsAdmin(),
  ]);

  const serializedOperators = operators.map((op) => ({
    id: op.id,
    username: op.username,
    email: op.email,
    name: op.name,
    status: (op.status as 'active' | 'inactive' | 'suspended') || 'active',
    mustChangePassword: op.mustChangePassword,
    isBootstrapAdmin: op.isBootstrapAdmin,
    isAvailable: op.isAvailable,
    availabilityNote: op.availabilityNote,
    lastLoginAt: op.lastLoginAt ? op.lastLoginAt.toISOString() : null,
    createdAt: op.createdAt.toISOString(),
    roles: op.roles.map((r) => ({
      roleId: r.roleId,
      slug: r.slug,
      nameFa: r.nameFa,
    })),
    departments: op.departments.map((d) => ({
      departmentId: d.departmentId,
      nameFa: d.nameFa,
      slug: d.slug,
      isManager: d.isManager,
      isAvailable: d.isAvailable,
      maxActiveTickets: d.maxActiveTickets,
    })),
    overrides: op.overrides.map((o) => ({
      permissionId: o.permissionId,
      permissionKey: o.permissionKey,
      permissionNameFa: o.permissionNameFa,
      effect: (o.effect as 'allow' | 'deny') || 'allow',
      reason: o.reason,
    })),
  }));

  const canManageRoles = hasPermission(session.access, 'admin:roles:manage');

  return (
    <OperatorsManager
      initialOperators={serializedOperators}
      roles={roleData.roles.map((r) => ({
        id: r.id,
        slug: r.slug,
        nameFa: r.nameFa,
        descriptionFa: r.descriptionFa ?? '',
        isSystem: r.isSystem,
      }))}
      permissions={roleData.permissions.map((p) => ({
        id: p.id,
        key: p.key,
        module: p.module,
        nameFa: p.nameFa,
        descriptionFa: p.descriptionFa ?? '',
      }))}
      departments={departments.map((d) => ({
        id: d.id,
        nameFa: d.nameFa,
        slug: d.slug,
        isActive: d.isActive,
      }))}
      canManageRoles={canManageRoles}
      currentUserId={session.user.id}
    />
  );
}
