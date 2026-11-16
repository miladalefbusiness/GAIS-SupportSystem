import { NextResponse } from 'next/server';
import { getCurrentSession, type AuthenticatedSession } from './auth.ts';
import { canAccessDepartment, hasPermission } from './rbac.ts';

export type GuardResult =
  | { ok: true; session: AuthenticatedSession }
  | { ok: false; response: NextResponse };

export async function requireAuth(options?: {
  allowPasswordChangeRequired?: boolean;
}): Promise<GuardResult> {
  const session = await getCurrentSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'احراز هویت انجام نشده است. لطفاً وارد شوید.' },
        { status: 401 }
      ),
    };
  }

  if (
    !options?.allowPasswordChangeRequired &&
    session.user.mustChangePassword
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'تغییر رمز عبور اولیه برای ادامه کار الزامی است.',
          code: 'PASSWORD_CHANGE_REQUIRED',
        },
        { status: 403 }
      ),
    };
  }

  return { ok: true, session };
}

export async function requirePermission(
  permissionKey: string
): Promise<GuardResult> {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult;

  if (!hasPermission(authResult.session.access, permissionKey)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'شما مجوز لازم برای انجام این عملیات را ندارید.',
          code: 'FORBIDDEN',
        },
        { status: 403 }
      ),
    };
  }

  return authResult;
}

export async function requireAnyPermission(
  permissionKeys: string[]
): Promise<GuardResult> {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult;

  const allowed = permissionKeys.some((key) =>
    hasPermission(authResult.session.access, key)
  );
  if (!allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'شما مجوز لازم برای انجام این عملیات را ندارید.',
          code: 'FORBIDDEN',
        },
        { status: 403 }
      ),
    };
  }

  return authResult;
}

export async function requireDepartmentAccess(
  departmentId: string,
  requiredPermission = 'desk:workspace:access'
): Promise<GuardResult> {
  const authResult = await requirePermission(requiredPermission);
  if (!authResult.ok) return authResult;

  if (!canAccessDepartment(authResult.session.access, departmentId)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'دسترسی به این دپارتمان برای حساب کاربری شما مجاز نیست.',
          code: 'DEPARTMENT_ACCESS_DENIED',
        },
        { status: 403 }
      ),
    };
  }

  return authResult;
}
