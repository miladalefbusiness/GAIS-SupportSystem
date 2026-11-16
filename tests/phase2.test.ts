import { describe, expect, it } from 'vitest';
import { resolveEffectivePermissions } from '../src/core/auth/permissions-catalog.ts';
import {
  canAccessDepartment,
  canManageDepartment,
  hasPermission,
  type UserAccessProfile,
} from '../src/core/auth/rbac.ts';
import {
  createDepartmentSchema,
  updateDepartmentMembersSchema,
  updateDepartmentSchema,
} from '../src/modules/departments/schemas.ts';
import {
  createOperatorSchema,
  updateOperatorSchema,
} from '../src/modules/operators/schemas.ts';
import {
  createRoleSchema,
  updateRoleSchema,
} from '../src/modules/roles/schemas.ts';

function makeAccessProfile(
  overrides: Partial<UserAccessProfile> = {}
): UserAccessProfile {
  return {
    roles: [],
    permissions: [],
    departments: [],
    isSuperAdmin: false,
    ...overrides,
  };
}

describe('Phase 2 Department Isolation & Validation Tests', () => {
  it('enforces cross-department access boundaries for operators and department managers', () => {
    const deptAOperator = makeAccessProfile({
      roles: [{ id: 'role_operator', slug: 'operator', nameFa: 'اپراتور' }],
      permissions: ['desk:workspace:access', 'desk:tickets:view_department'],
      departments: [
        {
          departmentId: 'dept-a',
          slug: 'billing',
          nameFa: 'امور مالی',
          isActive: true,
          isManager: false,
          isAvailable: true,
          maxActiveTickets: 15,
        },
      ],
    });

    expect(canAccessDepartment(deptAOperator, 'dept-a')).toBe(true);
    expect(canAccessDepartment(deptAOperator, 'dept-b')).toBe(false);
    expect(canManageDepartment(deptAOperator, 'dept-a')).toBe(false);
    expect(canManageDepartment(deptAOperator, 'dept-b')).toBe(false);

    const deptAManager = makeAccessProfile({
      roles: [{ id: 'role_dept_manager', slug: 'dept_manager', nameFa: 'مدیر دپارتمان' }],
      permissions: ['desk:workspace:access', 'desk:tickets:view_department'],
      departments: [
        {
          departmentId: 'dept-a',
          slug: 'billing',
          nameFa: 'امور مالی',
          isActive: true,
          isManager: true,
          isAvailable: true,
          maxActiveTickets: 20,
        },
      ],
    });

    expect(canAccessDepartment(deptAManager, 'dept-a')).toBe(true);
    expect(canManageDepartment(deptAManager, 'dept-a')).toBe(true);
    expect(canAccessDepartment(deptAManager, 'dept-b')).toBe(false);
    expect(canManageDepartment(deptAManager, 'dept-b')).toBe(false);
  });

  it('grants org-wide department access only to super_admin or holders of desk:tickets:view_all', () => {
    const unassignedViewer = makeAccessProfile({
      permissions: ['desk:workspace:access'],
      departments: [],
    });
    expect(canAccessDepartment(unassignedViewer, 'dept-a')).toBe(false);

    const orgAuditor = makeAccessProfile({
      permissions: ['desk:workspace:access', 'desk:tickets:view_all'],
      departments: [],
    });
    expect(canAccessDepartment(orgAuditor, 'dept-a')).toBe(true);
    expect(canAccessDepartment(orgAuditor, 'dept-b')).toBe(true);
    expect(canManageDepartment(orgAuditor, 'dept-b')).toBe(false);

    // Explicit deny override revokes org-wide view permission
    const restrictedPerms = resolveEffectivePermissions(
      ['desk:workspace:access', 'desk:tickets:view_all'],
      [{ permissionKey: 'desk:tickets:view_all', effect: 'deny' }]
    );
    const strippedAuditor = makeAccessProfile({
      permissions: restrictedPerms,
      departments: [],
    });
    expect(hasPermission(strippedAuditor, 'desk:tickets:view_all')).toBe(false);
    expect(canAccessDepartment(strippedAuditor, 'dept-a')).toBe(false);
  });

  it('validates department CRUD and membership payloads strictly with Zod', () => {
    const valid = createDepartmentSchema.safeParse({
      nameFa: 'پشتیبانی فنی',
      slug: 'tech-support',
      descriptionFa: 'رفع اشکالات سامانه‌ها',
      iconKey: 'wrench',
      displayOrder: 2,
      isActive: true,
      isPublic: true,
      aiEnabled: true,
      humanOperatorsAvailable: true,
      assignmentStrategy: 'least_loaded',
      welcomeMessageFa: 'خوش آمدید',
      maxUploadSizeMb: 25,
    });
    expect(valid.success).toBe(true);

    const invalidSlug = createDepartmentSchema.safeParse({
      nameFa: 'مالی',
      slug: 'bad slug!',
    });
    expect(invalidSlug.success).toBe(false);

    const invalidSize = updateDepartmentSchema.safeParse({
      maxUploadSizeMb: 999,
    });
    expect(invalidSize.success).toBe(false);

    const validMembers = updateDepartmentMembersSchema.safeParse({
      members: [
        {
          userId: 'user-1',
          isManager: true,
          isAvailable: true,
          maxActiveTickets: 25,
        },
      ],
    });
    expect(validMembers.success).toBe(true);
  });

  it('validates operator creation, password rules, and role payloads strictly with Zod', () => {
    const weakPass = createOperatorSchema.safeParse({
      username: 'ali.reza',
      email: 'ali@org.local',
      name: 'علی رضایی',
      password: 'onlyletterslong',
      roleIds: ['role_operator'],
    });
    expect(weakPass.success).toBe(false);

    const noRoles = createOperatorSchema.safeParse({
      username: 'ali.reza',
      email: 'ali@org.local',
      name: 'علی رضایی',
      password: 'StrongPassword123',
      roleIds: [],
    });
    expect(noRoles.success).toBe(false);

    const validOp = createOperatorSchema.safeParse({
      username: 'ali.reza',
      email: 'ali@org.local',
      name: 'علی رضایی',
      password: 'StrongPassword123',
      roleIds: ['role_operator'],
      departments: [{ departmentId: 'dept-1', isManager: false, maxActiveTickets: 15 }],
    });
    expect(validOp.success).toBe(true);

    const validPatch = updateOperatorSchema.safeParse({
      status: 'suspended',
      resetPassword: 'NewPassword987',
    });
    expect(validPatch.success).toBe(true);

    const badRoleSlug = createRoleSchema.safeParse({
      slug: 'invalid-hyphen',
      nameFa: 'نقش تستی',
    });
    expect(badRoleSlug.success).toBe(false);

    const validRoleUpdate = updateRoleSchema.safeParse({
      nameFa: 'اپراتور ارشد',
      permissionIds: ['perm_desk_workspace'],
    });
    expect(validRoleUpdate.success).toBe(true);
  });
});
