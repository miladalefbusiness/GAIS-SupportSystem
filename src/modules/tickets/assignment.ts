import { and, asc, eq, notInArray, sql } from 'drizzle-orm';
import { db } from '@/src/db/index.ts';
import {
  departmentMemberships,
  departmentRoutingState,
  operatorAvailability,
  tickets,
  users,
} from '@/src/db/schema.ts';

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface AssignedOperatorSummary {
  userId: string;
  name: string;
  activeCount: number;
  maxActiveTickets: number;
}

export interface AllocationDecision {
  referenceCode: string;
  strategyUsed: 'round_robin' | 'least_loaded' | 'manual_queue';
  assignedOperator: AssignedOperatorSummary | null;
}

function makeDepartmentCodePrefix(slug: string, id: string): string {
  const cleaned = slug
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4);
  const idSuffix = id.replace(/[^a-zA-Z0-9]/g, '').slice(-3).toUpperCase();
  return cleaned.length >= 2 ? `${cleaned}${idSuffix.slice(0, 2)}` : `D${idSuffix}`;
}

/**
 * Concurrency-safe per-department ticket reference sequence generator and
 * deterministic fair ticket distribution engine.
 *
 * Uses `SELECT ... FOR UPDATE` on `department_routing_state` inside the active
 * database transaction so concurrent ticket creation in the same department is
 * serialized cleanly without duplicate sequences or unbalanced operator skew.
 */
export async function allocateReferenceAndAssigneeInTx(
  tx: DbTransaction,
  department: {
    id: string;
    slug: string;
    assignmentStrategy: string;
  }
): Promise<AllocationDecision> {
  // 1. Ensure routing state row exists and acquire row lock
  await tx
    .insert(departmentRoutingState)
    .values({
      departmentId: department.id,
      ticketSeq: 0,
    })
    .onConflictDoNothing({ target: departmentRoutingState.departmentId });

  const lockResult = await tx.execute(
    sql`SELECT department_id, last_assigned_user_id, ticket_seq FROM department_routing_state WHERE department_id = ${department.id} FOR UPDATE`
  );

  const lockedRow = lockResult.rows[0] as
    | {
        department_id: string;
        last_assigned_user_id: string | null;
        ticket_seq: number | string;
      }
    | undefined;

  const currentSeq = Number(lockedRow?.ticket_seq ?? 0);
  const nextSeq = currentSeq + 1;
  const lastAssignedUserId = lockedRow?.last_assigned_user_id ?? null;

  const deptCode = makeDepartmentCodePrefix(department.slug, department.id);
  const referenceCode = `SD-${deptCode}-${String(nextSeq).padStart(5, '0')}`;

  const rawStrategy = department.assignmentStrategy;
  const strategy: 'round_robin' | 'least_loaded' | 'manual_queue' =
    rawStrategy === 'least_loaded'
      ? 'least_loaded'
      : rawStrategy === 'manual_queue'
      ? 'manual_queue'
      : 'round_robin';

  if (strategy === 'manual_queue') {
    await tx
      .update(departmentRoutingState)
      .set({ ticketSeq: nextSeq, updatedAt: new Date() })
      .where(eq(departmentRoutingState.departmentId, department.id));

    return {
      referenceCode,
      strategyUsed: 'manual_queue',
      assignedOperator: null,
    };
  }

  // 2. Fetch deterministic list of active, available operators in this department
  const members = await tx
    .select({
      userId: users.id,
      name: users.name,
      userStatus: users.status,
      membershipAvailable: departmentMemberships.isAvailable,
      maxActiveTickets: departmentMemberships.maxActiveTickets,
      globalAvailable: operatorAvailability.isAvailable,
    })
    .from(departmentMemberships)
    .innerJoin(users, eq(departmentMemberships.userId, users.id))
    .leftJoin(operatorAvailability, eq(users.id, operatorAvailability.userId))
    .where(eq(departmentMemberships.departmentId, department.id))
    .orderBy(asc(users.id));

  const activeCandidates = members.filter((m) => {
    const globalOk = m.globalAvailable !== false;
    return (
      m.userStatus === 'active' &&
      m.membershipAvailable &&
      globalOk &&
      m.maxActiveTickets > 0
    );
  });

  if (activeCandidates.length === 0) {
    await tx
      .update(departmentRoutingState)
      .set({ ticketSeq: nextSeq, updatedAt: new Date() })
      .where(eq(departmentRoutingState.departmentId, department.id));

    return {
      referenceCode,
      strategyUsed: strategy,
      assignedOperator: null,
    };
  }

  // 3. Count active open tickets per candidate operator inside this transaction
  const countsRows = await tx
    .select({
      operatorId: tickets.assignedOperatorId,
      activeCount: sql<number>`count(*)::int`,
    })
    .from(tickets)
    .where(notInArray(tickets.status, ['resolved', 'closed']))
    .groupBy(tickets.assignedOperatorId);

  const countMap = new Map<string, number>();
  for (const r of countsRows) {
    if (r.operatorId) {
      countMap.set(r.operatorId, Number(r.activeCount));
    }
  }

  const underCap = activeCandidates
    .map((m) => ({
      userId: m.userId,
      name: m.name,
      maxActiveTickets: m.maxActiveTickets,
      activeCount: countMap.get(m.userId) ?? 0,
    }))
    .filter((m) => m.activeCount < m.maxActiveTickets);

  if (underCap.length === 0) {
    await tx
      .update(departmentRoutingState)
      .set({ ticketSeq: nextSeq, updatedAt: new Date() })
      .where(eq(departmentRoutingState.departmentId, department.id));

    return {
      referenceCode,
      strategyUsed: strategy,
      assignedOperator: null,
    };
  }

  let chosen: AssignedOperatorSummary;
  const lastIndex = lastAssignedUserId
    ? underCap.findIndex((op) => op.userId === lastAssignedUserId)
    : -1;

  if (strategy === 'round_robin') {
    const nextIdx = lastIndex >= 0 ? (lastIndex + 1) % underCap.length : 0;
    chosen = underCap[nextIdx];
  } else {
    // least_loaded: find minimum activeCount, breaking ties in circular order after lastAssignedUserId
    const rotated =
      lastIndex >= 0
        ? [...underCap.slice(lastIndex + 1), ...underCap.slice(0, lastIndex + 1)]
        : underCap;

    chosen = rotated[0];
    for (const op of rotated) {
      if (op.activeCount < chosen.activeCount) {
        chosen = op;
      }
    }
  }

  await tx
    .update(departmentRoutingState)
    .set({
      ticketSeq: nextSeq,
      lastAssignedUserId: chosen.userId,
      updatedAt: new Date(),
    })
    .where(eq(departmentRoutingState.departmentId, department.id));

  return {
    referenceCode,
    strategyUsed: strategy,
    assignedOperator: chosen,
  };
}
