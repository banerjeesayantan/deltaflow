"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckIcon, Loader2Icon, XIcon } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Plan {
  name: string;
  slug: "free-plan" | "pro-plan" | "business-plan";
  price: string;
  period?: string;
  description: string;
  everythingInPrevious?: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
}

// Synced to match the actual Polar product configuration exactly.
// If you change a plan in Polar, update it here too — this is
// marketing copy only, Polar is still the source of truth for billing.
const plans: Plan[] = [
  {
    name: "Free",
    slug: "free-plan",
    price: "$0",
    description: "Try DeltaFlow with the essentials.",
    features: [
      "5 active workflows",
      "500 workflow executions / month",
      "50 AI requests / month",
      "HTTP requests",
      "Google Forms integration",
      "Discord integration",
      "Slack integration",
      "Community support",
    ],
    cta: "Get started",
  },
  {
    name: "Pro",
    slug: "pro-plan",
    price: "$19",
    period: "/month",
    description: "For builders running real automations.",
    everythingInPrevious: "Everything in Free, plus:",
    features: [
      "Unlimited workflows",
      "20,000 workflow executions / month",
      "5,000 AI requests / month",
      "OpenAI integration",
      "Google Gemini integration",
      "Anthropic Claude integration",
      "HTTP requests & webhooks",
      "Stripe integration",
      "Priority support",
      "90 days execution history",
    ],
    cta: "Upgrade to Pro",
    highlighted: true,
  },
  {
    name: "Business",
    slug: "business-plan",
    price: "$49",
    period: "/month",
    description: "For teams scaling automation across the org.",
    everythingInPrevious: "Everything in Pro, plus:",
    features: [
      "100,000 workflow executions / month",
      "25,000 AI requests / month",
      "Team workspace",
      "Shared workflows & credentials",
      "Role-based access control",
      "API access",
      "Advanced logs & monitoring",
      "Priority execution queue",
      "1 year execution history",
      "Premium email support",
    ],
    cta: "Upgrade to Business",
  },
];

export const PricingSection = () => {
  const [loadingSlug, setLoadingSlug] = useState<Plan["slug"] | null>(null);

  const handleCheckout = (slug: Plan["slug"]) => {
    setLoadingSlug(slug);
    authClient.checkout({ slug }).catch(() => setLoadingSlug(null));
  };

  return (
    <section className="relative py-20 px-6 bg-background overflow-hidden">
      {/* Close button — returns to wherever the user came from */}
      <Link
        href="/workflows"
        className="absolute top-6 right-6 flex size-9 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        aria-label="Close"
      >
        <XIcon className="size-4" />
      </Link>

      {/* ghosted brand mark behind the Pro card */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.04] dark:opacity-[0.06]"
      >
        <svg width="520" height="520" viewBox="0 0 1922 1922" fill="none">
          <path
            d="M180 220 C280 220 360 400 360 600 C360 800 280 980 180 980 Z"
            className="fill-primary"
          />
          <path
            d="M460 220 C620 220 750 400 750 600 C750 800 620 980 460 980 Z"
            className="fill-primary"
          />
        </svg>
      </div>

      <div className="relative max-w-5xl mx-auto text-center mb-14">
        <p className="text-sm font-medium tracking-wide text-primary mb-3">
          Pricing
        </p>
        <h2 className="text-3xl md:text-4xl font-semibold text-foreground tracking-tight">
          One workflow platform, three ways to run it
        </h2>
        <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
          Start free. Move up when your automations outgrow the plan you're
          on — nothing to migrate, nothing to rebuild.
        </p>
      </div>

      <div className="relative max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
        {plans.map((plan) => (
          <div
            key={plan.slug}
            className={cn(
              "relative rounded-2xl border p-8 flex flex-col bg-card",
              plan.highlighted
                ? "border-primary/60 shadow-[0_0_60px_-15px_var(--primary)] md:-translate-y-3"
                : "border-border"
            )}
          >
            {plan.highlighted && (
              <span className="absolute -top-3 left-8 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                Most popular
              </span>
            )}

            <h3 className="text-lg font-medium text-card-foreground">
              {plan.name}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {plan.description}
            </p>

            <div className="mt-6 flex items-baseline gap-1">
              <span className="text-4xl font-semibold text-card-foreground tracking-tight">
                {plan.price}
              </span>
              {plan.period && (
                <span className="text-muted-foreground text-sm">
                  {plan.period}
                </span>
              )}
            </div>

            {plan.everythingInPrevious && (
              <p className="mt-6 text-xs font-medium text-muted-foreground">
                {plan.everythingInPrevious}
              </p>
            )}

            <ul className={cn("space-y-3 flex-1", plan.everythingInPrevious ? "mt-3" : "mt-6")}>
              {plan.features.map((feature) => (
                <li
                  key={feature}
                  className="flex items-start gap-2 text-sm text-card-foreground/90"
                >
                  <CheckIcon className="size-4 text-primary mt-0.5 shrink-0" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            <Button
              onClick={() => handleCheckout(plan.slug)}
              disabled={loadingSlug !== null}
              className={cn(
                "mt-8 w-full",
                plan.highlighted
                  ? "bg-primary hover:bg-primary/90 text-primary-foreground"
                  : "bg-secondary hover:bg-secondary/80 text-secondary-foreground border border-border"
              )}
            >
              {loadingSlug === plan.slug ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  Redirecting…
                </>
              ) : (
                plan.cta
              )}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
};