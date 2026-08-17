import { Connection, Node } from "@/generated/prisma";
import toposort from "toposort";
import { inngest } from "./client";
import { createId } from "@paralleldrive/cuid2";
import prisma from "@/lib/db";
import { getUserPlan, tryConsumeExecution } from "@/lib/entitlements";

export const topologicalSort = (
  nodes: Node[],
  connections: Connection[],
): Node[] => {
  // If no connections, return node as-is (they're all independent)
  if (connections.length === 0) {
    return nodes;
  }

  // Create edges array for toposort
  const edges: [string, string][] = connections.map((conn) => [
    conn.fromNodeId,
    conn.toNodeId,
  ]);

  // Add nodes with no connections as self-edges to ensure they're included
  const connectedNodeIds = new Set<string>();
  for (const conn of connections) {
    connectedNodeIds.add(conn.fromNodeId);
    connectedNodeIds.add(conn.toNodeId);
  }

  for (const node of nodes) {
    if (!connectedNodeIds.has(node.id)) {
      edges.push([node.id, node.id]);
    }
  }

  // Perform topological sort
  let sortedNodeIds: string[];
  try {
    sortedNodeIds = toposort(edges);
    // Remove duplicates (from self-edges)
    sortedNodeIds = [...new Set(sortedNodeIds)];
  } catch (error) {
    if (error instanceof Error && error.message.includes("Cyclic")) {
      throw new Error("Workflow contains a cycle");
    }
    throw error;
  }

  // Map sorted IDs back to node objects
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  return sortedNodeIds.map((id) => nodeMap.get(id)!).filter(Boolean);
};

/**
 * Thrown when a workflow can't run because its owner is over their
 * plan's monthly execution quota. Callers (tRPC router, webhook
 * routes) catch this and respond appropriately for their context.
 */
export class ExecutionLimitError extends Error {}

/**
 * The single, shared entry point for starting a workflow execution —
 * used by the manual "Run" button (via workflowsRouter.execute) AND
 * both webhook routes (Google Form, Stripe). Putting the quota check
 * HERE, instead of in each caller, means every trigger path is
 * protected automatically — no future trigger type can accidentally
 * forget to enforce it.
 */
export const sendWorkflowExecution = async (data: {
  workflowId: string;
  [key: string]: any;
}) => {
  const workflow = await prisma.workflow.findUniqueOrThrow({
    where: { id: data.workflowId },
    select: { userId: true },
  });

  const plan = await getUserPlan(workflow.userId);
  const allowed = await tryConsumeExecution(workflow.userId, plan);

  if (!allowed) {
    throw new ExecutionLimitError(
      `Monthly execution limit reached on the ${plan} plan.`
    );
  }

  return inngest.send({
    name: "workflows/execute.workflow",
    data,
    id: createId(),
  });
};