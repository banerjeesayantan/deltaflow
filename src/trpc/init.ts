import { auth } from '@/lib/auth';
import { getUserPlan } from '@/lib/entitlements';
import { initTRPC, TRPCError } from '@trpc/server';
import { headers } from 'next/headers';
import { cache } from 'react';
import superjson from "superjson"

export const createTRPCContext = cache(async () => {
  return {};
});

const t = initTRPC.create({
  transformer: superjson,
});

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const baseProcedure = t.procedure;

export const protectedProcedure = baseProcedure.use(async ({ ctx, next }) => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  }

  return next({ ctx: { ...ctx, auth: session } });
});

/**
 * Authenticated user + real plan attached to context.
 * Does NOT gate access by itself — Free is a legitimate, usable plan.
 * Each router enforces its own limit using ctx.plan, via the
 * assert*Entitlement helpers in @/lib/entitlements.
 *
 * baseProcedure -> protectedProcedure -> entitledProcedure -> specific check
 */
export const entitledProcedure = protectedProcedure.use(
  async ({ ctx, next }) => {
    const plan = await getUserPlan(ctx.auth.user.id);
    return next({ ctx: { ...ctx, plan } });
  },
);