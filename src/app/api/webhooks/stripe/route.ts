import { sendWorkflowExecution, ExecutionLimitError } from "@/inngest/utils";
import { type NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;

export async function POST(request: NextRequest) {
  // Stripe signs the exact raw bytes of the request. Reading this as
  // JSON first (request.json()) would break verification below, since
  // the re-serialized JSON isn't guaranteed to match what Stripe
  // actually signed. Always read as text for webhook routes.
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { success: false, error: "Missing stripe-signature header" },
      { status: 400 },
    );
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    console.error("Stripe webhook signature verification failed:", error);
    return NextResponse.json(
      { success: false, error: "Invalid signature" },
      { status: 400 },
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

    const stripeData = {
      eventId: event.id,
      eventType: event.type,
      timestamp: event.created,
      livemode: event.livemode,
      raw: event.data.object,
    };

    await sendWorkflowExecution({
      workflowId,
      initialData: {
        stripe: stripeData,
      },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    if (error instanceof ExecutionLimitError) {
      // Not the caller's fault — don't ask Stripe to retry this one.
      console.warn("Stripe-triggered execution skipped:", error.message);
      return NextResponse.json({ success: false, error: error.message }, { status: 200 });
    }

    console.error("Stripe webhook error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to process Stripe event" },
      { status: 500 },
    );
  }
}