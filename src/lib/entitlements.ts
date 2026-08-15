import { polarClient } from "@/lib/polar";
import prisma from "@/lib/db";

export type Plan = "free" | "pro" | "business";

// Maps Polar product IDs (from your .env) to internal plan names.
// This is the ONLY place plan identity is decided — keep it in sync
// with whatever products actually exist in your Polar dashboard.
const PRODUCT_ID_TO_PLAN: Record<string, Plan> = {
  [process.env.POLAR_PRODUCT_FREE as string]: "free",
  [process.env.POLAR_PRODUCT_PRO as string]: "pro",
  [process.env.POLAR_PRODUCT_BUSINESS as string]: "business",
};

// Monthly workflow execution limits per plan.
// Keep these in sync with what pricing-section.tsx advertises.
export const EXECUTION_LIMITS: Record<Plan, number> = {
  free: 500,
  pro: 20000,
  business: 100000,
};

/**
 * The real, server-side source of truth for what plan a user is on.
 * Never trust a plan value that came from the client.
 */
export async function getUserPlan(userId: string): Promise<Plan> {
  try {
    const state = await polarClient.customers.getStateExternal({
      externalId: userId,
    });

    const activeProductId = state.activeSubscriptions?.[0]?.productId;

    if (activeProductId && PRODUCT_ID_TO_PLAN[activeProductId]) {
      return PRODUCT_ID_TO_PLAN[activeProductId];
    }

    return "free";
  } catch {
    // If Polar is unreachable or the customer doesn't exist yet,
    // fail closed to the most restrictive plan — never fail open.
    return "free";
  }
}

function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * Throws if the user has hit their plan's monthly execution limit.
 * Call this BEFORE creating a new execution record.
 */
export async function assertExecutionEntitlement(userId: string): Promise<void> {
  const plan = await getUserPlan(userId);
  const limit = EXECUTION_LIMITS[plan];

  const executionCount = await prisma.execution.count({
    where: {
      workflow: { userId },
      startedAt: { gte: startOfCurrentMonth() },
    },
  });

  if (executionCount >= limit) {
    throw new Error(
      `Execution limit reached: ${executionCount}/${limit} on the ${plan} plan this month.`
    );
  }
}