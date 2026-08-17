import { sendWorkflowExecution, ExecutionLimitError } from "@/inngest/utils";
import { type NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

/**
 * Google Forms has no built-in request-signing the way Stripe does —
 * there's no equivalent of a stripe-signature header to verify. The
 * standard fix is a shared secret: your Google Apps Script (the
 * thing that actually POSTs here on form submit) sends a secret
 * token that only it and this server know, and we reject anything
 * that doesn't match.
 *
 * Set GOOGLE_FORM_WEBHOOK_SECRET in your .env, and configure your
 * Apps Script to send the same value as an "x-webhook-secret" header.
 */
function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.GOOGLE_FORM_WEBHOOK_SECRET;
  const provided = request.headers.get("x-webhook-secret");

  if (!expected || !provided) return false;

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);

  // Constant-time comparison — a plain === leaks timing information
  // that could theoretically help an attacker guess the secret
  // character by character.
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const url = new URL(request.url);
    const workflowId = url.searchParams.get("workflowId");

    if (!workflowId) {
      return NextResponse.json(
        { success: false, error: "Missing required query parameter: workflowId" },
        { status: 400 },
      );
    }

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

