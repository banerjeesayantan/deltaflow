import prisma from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { sendWorkflowExecution, ExecutionLimitError } from "@/inngest/utils";
import { type NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

/**
 * Google Forms has no built-in request-signing the way Stripe does —
 * there's no equivalent of a stripe-signature header to verify. The
 * fix is a shared secret, scoped per-workflow: your Apps Script sends
 * the secret for THAT specific workflow, and we look up and compare
 * against THAT workflow's stored, encrypted secret — not a single
 * global one. This means a leaked token for Workflow A can never be
 * replayed against Workflow B.
 *
 * Wrapped in try/catch: if decrypt() ever throws (corrupted stored
 * value, encryption key mismatch, etc.), that's treated as "not
 * authorized" rather than an unhandled crash.
 */
async function isAuthorized(workflowId: string, request: NextRequest): Promise<boolean> {
  try {
    const provided = request.headers.get("x-webhook-secret");
    if (!provided) return false;

    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { webhookSecret: true },
    });

    if (!workflow?.webhookSecret) return false;

    const expected = decrypt(workflow.webhookSecret);

    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(provided);

    // Constant-time comparison — a plain === leaks timing information
    // that could theoretically help an attacker guess the secret
    // character by character.
    if (expectedBuf.length !== providedBuf.length) return false;
    return timingSafeEqual(expectedBuf, providedBuf);
  } catch (error) {
    console.error("Google form webhook authorization error:", error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const workflowId = url.searchParams.get("workflowId");

  if (!workflowId) {
    return NextResponse.json(
      { success: false, error: "Missing required query parameter: workflowId" },
      { status: 400 },
    );
  }

  if (!(await isAuthorized(workflowId, request))) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const body = await request.json();

    const formData = {
      formId: body.formId,
      formTitle: body.formTitle,
      responseId: body.responseId,
      timestamp: body.timestamp,
      respondentEmail: body.respondentEmail,
      responses: body.responses,
      raw: body,
    };

    await sendWorkflowExecution({
      workflowId,
      initialData: {
        googleForm: formData,
      },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    if (error instanceof ExecutionLimitError) {
      console.warn("Google Form-triggered execution skipped:", error.message);
      return NextResponse.json({ success: false, error: error.message }, { status: 200 });
    }

    console.error("Google form webhook error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to process Google Form submission" },
      { status: 500 },
    );
  }
}
