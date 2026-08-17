import { polarClient } from "@/lib/polar";
import prisma from "@/lib/db";

export type Plan = "free" | "pro" | "business";

const PRODUCT_ID_TO_PLAN: Record<string, Plan> = {
  [process.env.POLAR_PRODUCT_FREE as string]: "free",
  [process.env.POLAR_PRODUCT_PRO as string]: "pro",
  [process.env.POLAR_PRODUCT_BUSINESS as string]: "business",
};

export const EXECUTION_LIMITS: Record<Plan, number> = {
  free: 500,
  pro: 20000,
  business: 100000,
};

export const WORKFLOW_LIMITS: Record<Plan, number> = {
  free: 5,
  pro: Infinity,
  business: Infinity,
};

export const CREDENTIAL_LIMITS: Record<Plan, number> = {
  free: 3,
  pro: 100,
  business: Infinity,
};

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
    return "free";
  }
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function tryConsumeExecution(
  userId: string,
  plan: Plan
): Promise<boolean> {
  const limit = EXECUTION_LIMITS[plan];
  const period = currentPeriod();

  await prisma.usageCounter.upsert({
    where: { userId_period: { userId, period } },
    create: { userId, period, count: 0 },
    update: {},
  });

  const result = await prisma.$executeRaw`
    UPDATE "usage_counter"
    SET count = count + 1
    WHERE "userId" = ${userId}
      AND period = ${period}
      AND count < ${limit}
  `;

  return result > 0;
}

export async function assertWorkflowEntitlement(
  userId: string,
  plan: Plan
): Promise<void> {
  const limit = WORKFLOW_LIMITS[plan];
  if (limit === Infinity) return;

  const workflowCount = await prisma.workflow.count({
    where: { userId },
  });

  if (workflowCount >= limit) {
    throw new Error(
      `Workflow limit reached: ${workflowCount}/${limit} on the ${plan} plan.`
    );
  }
}

export async function assertCredentialEntitlement(
  userId: string,
  plan: Plan
): Promise<void> {
  const limit = CREDENTIAL_LIMITS[plan];
  if (limit === Infinity) return;

  const credentialCount = await prisma.credential.count({
    where: { userId },
  });

  if (credentialCount >= limit) {
    throw new Error(
      `Credential limit reached: ${credentialCount}/${limit} on the ${plan} plan.`
    );
  }
}