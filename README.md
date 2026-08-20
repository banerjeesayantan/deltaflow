<div align="center">

# DeltaFlow

### The $0 Bug: How a Free Plan Almost Broke My Own Business Model

*A case study in what happens when "it compiles" isn't the same thing as "it works."*




<img width="1920" height="1440" alt="Image" src="https://github.com/user-attachments/assets/e7e7c519-5596-41a7-888a-401c58bcdfd7" />

<img width="1920" height="1080" alt="Image" src="https://github.com/user-attachments/assets/f0658788-5e75-4fa2-a76e-14fbf45f953f" />

<img width="1920" height="1280" alt="Image" src="https://github.com/user-attachments/assets/38380952-4547-4cbe-bf8e-cc527903dd6e" />




**[Live Demo](https://deltaflow-lime.vercel.app)** · **[Read the Bug](#chapter-1--the-3am-question)** · **[See the Fix](#chapter-3--the-atomic-fix)** · **[Scaling & Cost](#chapter-5--why-it-scales-without-costing-more)** · **[Skip to Tech Stack](#appendix-tech-stack)**

![Next.js](https://img.shields.io/badge/Next.js_15-000000?style=flat&logo=next.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)
![tRPC](https://img.shields.io/badge/tRPC-2596BE?style=flat&logo=trpc&logoColor=white)

</div>

---

> **If you only have 90 seconds:** I built a workflow-automation SaaS (a Zapier competitor), gave it three real pricing tiers, and then discovered my own Free plan was silently unusable in production — a bug that would have made my own product's front door broken for every non-paying visitor. This document is the story of finding that bug, understanding *why* it happened, and rebuilding the billing enforcement layer to be genuinely correct — atomic, race-condition-safe, and impossible to bypass from the client. If that sentence made you curious rather than bored, keep reading. If you just want the tech stack, [it's at the bottom](#appendix-tech-stack).

---

## Chapter 1 — The 3AM Question

Here's a question that most tutorials never make you answer: **when someone signs up for your "Free" plan, can they actually use your product?**

It sounds obvious. Of course they can — that's what "Free" means. But I want to tell you about the night I discovered my own product's answer was, quietly, *no*.

I'd just finished wiring up three Polar subscription tiers — Free, Pro, Business — into DeltaFlow, my AI workflow automation platform (think: a leaner, more transparent Zapier). The pricing page looked sharp. The checkout flow worked. I was ready to call the billing system done.

Then I did something a lot of solo builders skip: **I tested against a real production build instead of trusting my local dev server.**

I created a brand-new account. Free tier, zero payment. I clicked "New Workflow."

```
403 FORBIDDEN — Active subscription required.
```

My own Free plan — the one my pricing page proudly advertised as *"5 active workflows, 500 executions a month, no credit card"* — was completely, silently locked. Every single new signup was hitting a wall before they'd built a single thing.

**This is the moment this whole README is actually about.** Not because the bug itself was exotic — it wasn't. It's about what it reveals: the gap between *"I added subscription tiers"* and *"my subscription tiers are actually correct"* is enormous, and almost nobody checks it, because it only shows up when you deliberately go looking for it.

---

## Chapter 2 — Why This Bug Is a Business Problem, Not Just a Code Problem

Let's put on a different hat for a second — not engineer, **operator**.

If DeltaFlow were a real company and this shipped, here's the math: every visitor who signs up for Free is a top-of-funnel lead. Free-to-paid conversion is the entire economic engine of a freemium SaaS business — you *cannot* upsell someone who never experienced the product. A broken Free tier isn't a minor bug ticket. It's a **silent, 100% top-of-funnel leak** that would show up nowhere in your dashboards except one place: a suspiciously flat signup-to-activation graph that nobody would think to investigate for weeks, because *the app "worked" — it just threw an error message that looked like a plan restriction, not a bug.*

That's the part I want a hiring manager to sit with. **This bug would have been invisible in every metric except revenue, and by the time revenue reflected it, the damage would already be weeks old.** Finding it required treating "does my billing logic actually match my pricing page" as a first-class engineering question — not an assumption.

So before I show you the fix, here's the actual root cause, because *why* it happened matters more than *that* it happened:

```typescript
// What I originally wrote — an all-or-nothing gate
export const premiumProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const customer = await polarClient.customers.getStateExternal({
    externalId: ctx.auth.user.id,
  });

  if (!customer.activeSubscriptions?.length) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Active subscription required" });
  }
  // ...
});
```

I named the middleware `premiumProcedure` and gave it exactly one job: *"does this user pay?"* That's a reasonable question for a feature that's genuinely Pro-only. But I'd also wired it in front of `workflows.create` — a feature that Free users are supposed to have, just with a **limit**, not a **wall**. I'd confused two entirely different questions:

- *"Is this feature paid-only?"* (a yes/no gate)
- *"Has this specific user hit their plan's limit?"* (a counted, per-plan threshold)

One middleware was trying to answer both, and it could only correctly answer one.

---

## Chapter 3 — The Atomic Fix

The real fix wasn't a patch. It was separating **authentication** from **authorization** — a distinction that sounds academic until you've been burned by conflating them:

```
Is this a real, logged-in user?          →  protectedProcedure   (authentication)
What plan are they actually on?          →  entitledProcedure    (attach plan to context)
Are THEY, specifically, over THEIR limit? →  assertWorkflowEntitlement(userId, plan)  (authorization)
```

Free stopped being a locked door and became what it was always supposed to be: **a real, usable plan with a real, enforced ceiling.**

```typescript
export async function assertWorkflowEntitlement(userId: string, plan: Plan): Promise<void> {
  const limit = WORKFLOW_LIMITS[plan]; // free: 5, pro/business: Infinity
  if (limit === Infinity) return;

  const workflowCount = await prisma.workflow.count({ where: { userId } });

  if (workflowCount >= limit) {
    throw new Error(`Workflow limit reached: ${workflowCount}/${limit} on the ${plan} plan.`);
  }
}
```

But fixing the wall was only half the job. Once I started actually enforcing *counted* limits instead of yes/no gates, a second, more subtle problem surfaced — one that most tutorials never mention at all.

### The bug that only shows up under load

Here's a question I'd never had to ask before: **what happens if two requests arrive at the exact same millisecond?**

Naive quota logic — *count existing rows, compare to a limit, then create* — looks completely correct in testing, because you're the only one clicking the button. But picture two browser tabs, or a flaky network causing a double-click, firing the same request twice, simultaneously:

```
Request A reads: 499 executions this month.  499 < 500 → ✅ allowed
Request B reads: 499 executions this month.  499 < 500 → ✅ allowed
                                                            └─→ Both succeed.
                                                                Free plan just did 501.
```

This is a textbook **TOCTOU bug** (time-of-check to time-of-use) — the kind of thing that never shows up in a demo, only in production, under real concurrent traffic, which is exactly when you can least afford it. The fix isn't "check more carefully." It's removing the gap between checking and acting entirely, by pushing the logic into the database itself as one atomic operation:

```sql
UPDATE "usage_counter"
SET count = count + 1
WHERE "userId" = $1 AND period = $2 AND count < $3
```

This single statement *is* the check-and-increment, indivisibly, because Postgres takes a row-level lock for the duration of the `UPDATE`. The second concurrent request doesn't race the first — it simply waits its turn, and by the time it runs, the row's `count` has already moved past the limit, so its own `WHERE count < $3` clause matches **zero rows**. No application-level locking. No retry logic. No distributed lock service. Just picking the one operation the database was already built to do safely.

---

## Chapter 4 — Trust No Front Door

There's a principle I kept coming back to while building this, and it's worth stating plainly, because it's the difference between a demo and a product:

> **Every single execution path has to hit the same gate — or the gate doesn't actually exist.**

I had three ways a workflow could start running: a manual "Run" button, a Google Form submission, a Stripe payment event. I'd built the quota check for the manual button first — and it worked. But the two webhook routes called the execution engine *directly*, completely bypassing it. A Free user could never exceed their limit by clicking a button in my UI, but they could exceed it infinitely by submitting a Google Form.

**A security control that only covers one of three doors isn't a security control. It's a false sense of one.**

```
 Manual "Run" ──────┐
 Google Form ───────┼──►  sendWorkflowExecution()   ← the ONE shared gate
 Stripe event ───────┘            │
                                   ▼
                        tryConsumeExecution()   ← atomic, race-safe, unbypassable
                                   │
                                   ▼
                                Inngest
```

I moved the check into `sendWorkflowExecution()` itself — the one function every trigger type was already calling, whether it knew it or not. Now there's exactly one place in the entire codebase where "should this execution be allowed to happen" gets decided. One place to get right. One place to audit. One place a future contributor — or a future me, six months from now — can't accidentally forget to protect when adding trigger #4.

### The webhook doors themselves were unlocked

While auditing those two webhook routes, I found something worse than the quota bypass: **neither verified the request actually came from Google or Stripe.** Anyone who found or guessed a workflow ID could `POST` directly to either endpoint and trigger someone else's paid AI workflow — spending their execution quota, sending messages through their connected Slack/Discord, on their dime.

I fixed each one differently, because they have genuinely different threat models — treating them identically would have been the wrong engineering call:

- **Stripe already signs every webhook cryptographically.** I just had to actually verify it — `stripe.webhooks.constructEvent()` against the raw request body. (The raw body matters: parsing it as JSON *first*, before verification, is a common mistake that silently breaks signature checking, because the re-serialized JSON isn't guaranteed to byte-match what Stripe actually signed.)
- **Google Forms has no equivalent signing mechanism at all.** So instead of one global shared secret (where a single leak compromises *every* user's forms simultaneously), I designed a **per-workflow** secret: each workflow generates and stores its own cryptographically random, encrypted-at-rest token, compared using `timingSafeEqual` — a constant-time comparison, so an attacker can't use response latency to guess the correct secret one character at a time. **A leaked secret now compromises exactly one workflow. Not the application.**

---

## Chapter 5 — Why It Scales Without Costing More

Here's a plain-language question worth asking about any backend system: **when 10,000 people use your app at the exact same second instead of 10, what actually happens?**

There are two ways to answer that, and they lead to very different bills.

**The expensive way — vertical scaling.** You buy one big, powerful server and keep it running 24 hours a day, whether 10 people are using it or 10,000. It's like renting a giant warehouse year-round because *one day a year* you might need the space. Most of the time, you're paying for empty square footage.

**The way DeltaFlow actually works — horizontal scaling.** Instead of one big always-on server, every request spins up its own small, temporary worker — a Vercel serverless function, an Inngest job — that exists just long enough to do its one task, then disappears. If 10,000 requests arrive at once, 10,000 small workers show up simultaneously. If nobody's using the app at 3AM, **zero workers exist, and I pay for zero.** It's the difference between owning a warehouse and renting exactly the truck you need, for exactly the hour you need it.

This is why the architecture in Chapter 4 — one shared function every trigger path funnels through — isn't just a security decision. **It's a cost decision.** I'm not paying for idle infrastructure between executions. I'm paying per execution, which means the bill scales with actual usage, not with worst-case capacity I have to guess in advance.

### But horizontal scaling has a catch — and it's the same bug from Chapter 3

Here's the part most explanations of "serverless scaling" skip entirely: **when you have many independent workers instead of one central server, none of them know what the others are doing.** There's no shared memory, no single place holding "the current count" in a variable — every worker is its own island.

That sounds like a performance win. It's also exactly why the race condition in Chapter 3 exists in the first place. With one big server, you can (badly) get away with checking a value in memory, because only one process is looking at it. **With horizontal scaling, dozens of workers might check the same "499 executions used" number at the identical millisecond — because there genuinely are dozens of separate, simultaneous workers now, not a metaphorical one.** Distributed systems don't just make race conditions *possible*. They make race conditions the **default expectation**, not an edge case.

This is why the fix couldn't live in application code at all — no amount of "check carefully in JavaScript" survives being run by fifty workers at once who can't see each other. It had to live in the one place *all* of those workers ultimately share: the database itself.

```sql
UPDATE "usage_counter"
SET count = count + 1
WHERE "userId" = $1 AND period = $2 AND count < $3
```

Postgres's row-level lock is the one thing every serverless worker, no matter how many spin up simultaneously, has to go through one at a time. It turns "many independent workers with no shared memory" from a liability back into a strength — they don't need to coordinate with each other, because they're all coordinating through the one thing that was always going to be consistent anyway: the database.

### The cost saving hiding inside that one line of SQL

There's a second, quieter cost decision in that fix, worth naming directly: **I didn't add a distributed lock service to solve this.**

The "textbook" way to coordinate many separate workers is usually something like Redis with a distributed locking pattern (Redlock) — a whole extra piece of infrastructure, with its own hosting cost, its own failure modes, and its own thing to monitor and keep alive. I didn't need it, because Postgres already does row-level locking natively, for free, as a normal part of what a database is. **The cheapest infrastructure is the infrastructure you don't have to add.** Recognizing that the database I already had could solve a distributed-systems problem — instead of reaching for a new service by default — is a cost decision as much as a technical one.



## Chapter 6 — What This Story Is Actually Proving

If you're reading this as a hiring manager, here's the honest translation of everything above, mapped to what you're actually screening for:

| What happened in the story | What it demonstrates |
|---|---|
| Found the Free-plan bug by testing production, not trusting dev | **Product ownership** — I don't assume "compiles" means "correct" |
| Understood the *business* cost of the bug before fixing the *code* | **Product/business thinking** — I can reason about funnel impact, not just stack traces |
| Diagnosed *why* one middleware answered two different questions | **Systems thinking** — separating authentication from authorization is a real architectural principle, not a buzzword |
| Found and fixed a concurrency bug nobody asked me to look for | **Engineering depth** — I think about what happens under real, simultaneous load, not just the happy path |
| Noticed the webhook routes bypassed my own quota system | **Security mindset** — "does the control I built actually cover every door" |
| Chose two *different* fixes for Stripe vs. Google Forms | **Judgment** — recognizing that superficially similar problems can have genuinely different correct solutions |
| Recognized horizontal scaling makes race conditions the default, not an edge case | **Distributed systems thinking** — understanding what changes when many independent workers replace one central server |
| Solved a multi-worker coordination problem using Postgres instead of adding Redis | **Cost-conscious engineering** — knowing which infrastructure you don't need is as valuable as knowing which you do |
| Wrote all of this down instead of hiding it | **Communication** — the ability to explain a technical decision to a non-technical stakeholder is a skill, not a formality |

I'm not showing you a finished feature list. I'm showing you **how I think when something is wrong and I have to figure out why** — because that's the actual job, in any full-stack, product, or AI engineering role. The code is available to read. The reasoning is what I actually want you to remember.

---

## What DeltaFlow Does (For Context)

A visual, node-based workflow builder — connect a **trigger** (form submission, Stripe payment, manual run) to a chain of **actions** (AI reasoning via OpenAI/Anthropic/Gemini, HTTP calls, Slack/Discord notifications), and DeltaFlow runs it reliably in the background, with automatic retries, real-time status, and full execution history.

| | |
|---|---|
| **Triggers** | Manual run · Google Form submission · Stripe events |
| **AI Actions** | OpenAI · Anthropic Claude · Google Gemini |
| **Integrations** | HTTP requests · Slack · Discord |
| **Billing** | Free / Pro / Business — enforced server-side, atomically, on every trigger path |

---

## The Entitlement System, In Full

| Limit | Free | Pro | Business |
|---|---:|---:|---:|
| Active workflows | 5 | Unlimited | Unlimited |
| Executions / month | 500 | 20,000 | 100,000 |
| Stored credentials | 3 | 100 | Unlimited |

Resolved from Polar's real subscription state on the server, every time — never trusted from anything the client sends. If Polar is briefly unreachable, the system fails **closed** to Free rather than ever silently granting unpaid access — a deliberate trade-off between availability and correctness, documented in code rather than left as a silent surprise.

---

## Architecture

```
Next.js 15 (App Router)  →  tRPC  →  Business logic + entitlement checks  →  Prisma  →  PostgreSQL (Neon)
```

```
                    DeltaFlow
                       │
              ┌────────┴────────┐
              │    Next.js 15   │
              │   TypeScript    │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │      tRPC       │
              │    API layer    │
              └────────┬────────┘
                       │
       ┌───────────────┼────────────────┐
       │               │                │
       ▼               ▼                ▼
   Better Auth      Prisma          Polar
       │               │             Billing
       │               ▼
       │          PostgreSQL
       │             Neon
       │
       ├── GitHub OAuth
       └── Google OAuth
                       │
                       ▼
                   Inngest
                       │
                       ▼
              Workflow Execution
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
      AI            HTTP          Notifications
       │
 ┌─────┼──────────────┐
 ▼     ▼              ▼
Gemini OpenAI      Anthropic
```

**External integrations:**

```
Google Forms → Google Form Webhook → DeltaFlow → Inngest
Stripe       → Stripe Webhook       → DeltaFlow → Inngest
Slack / Discord / HTTP ← Workflow Executor
```

---

## Security Engineering, Summarized

- **Ownership enforced at the query level** — every read/write includes `userId: ctx.auth.user.id` directly in the Prisma `where` clause, so a user cannot access another user's data by guessing an ID. The row simply doesn't match; there's no separate "check ownership" step to forget.
- **Credentials and webhook secrets encrypted at rest**, never stored in plaintext.
- **Per-workflow webhook secrets**, not a single global one — isolates a leak to one workflow instead of the whole application.
- **Constant-time comparison** (`timingSafeEqual`) closes a timing side-channel a naive `===` would leave open.
- **Dependency vulnerabilities reviewed** via `npm audit`; safe fixes applied immediately, major-version upgrades (Next.js, AI SDK, Sentry, Prisma) deliberately deferred rather than risked pre-launch — a documented trade-off, not an oversight.

---

## What I'd Build Next

Being specific about what's incomplete is more useful than pretending otherwise — this is a live list, not a formality:

- **Cache plan state locally**, synced via a Polar webhook handler, so entitlement checks stop depending on a live external API call for every single request — the natural next step for real production scale.
- **Reconcile Prisma migration history with actual schema state.** Early schema changes were applied via `db push` before migration discipline was fully established; `db push` remains the deliberate short-term approach while proper migration history gets rebuilt as a follow-up.
- **Automated test suite** for the entitlement and webhook-auth logic specifically — currently verified through deliberate manual testing, including temporarily lowering plan limits to confirm the quota system blocks exactly at the boundary, not just that it compiles.
- **Team workspaces and role-based access** for the Business tier — designed conceptually, not yet built.
- **Webhook secret rotation UI** — regeneration already works server-side; a "Regenerate secret" button in the trigger dialog is the small remaining UI step.

---

## Appendix: Tech Stack

- **Framework & Language** — Next.js 15 (App Router, Turbopack), TypeScript
- **API Layer** — tRPC, TanStack Query
- **Database** — PostgreSQL (Neon), Prisma ORM
- **Auth** — Better Auth (email/password, GitHub, Google OAuth)
- **Billing** — Polar (checkout, customer portal, subscription state)
- **Background Jobs** — Inngest (step functions, automatic retries, real-time pub/sub)
- **Workflow Canvas** — React Flow
- **AI Providers** — OpenAI, Anthropic, Google Gemini (via Vercel AI SDK)
- **Encryption** — Cryptr (credentials and per-workflow webhook secrets)
- **UI** — Tailwind CSS v4, shadcn/ui, Sonner, Lucide React
- **Monitoring** — Sentry

---

## Appendix: Environment Variables

| Variable | Service | Purpose |
|---|---|---|
| `DATABASE_URL` | Neon (PostgreSQL) | Primary database connection |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Better Auth | Session signing, auth callback base URL |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub OAuth | "Sign in with GitHub" |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth | "Sign in with Google" |
| `ENCRYPTION_KEY` | Cryptr | Encrypts credentials and per-workflow webhook secrets |
| `POLAR_ACCESS_TOKEN`, `POLAR_ORGANIZATION_ID`, `POLAR_PRODUCT_FREE/PRO/BUSINESS`, `POLAR_SUCCESS_URL`, `POLAR_SERVER` | Polar | Billing, checkout, subscription state |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Inngest | Background execution, retries, real-time pub/sub |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google Gemini | AI node execution |
| `OPENAI_API_KEY` | OpenAI | AI node execution |
| `ANTHROPIC_API_KEY` | Anthropic | AI node execution |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Sentry | Error monitoring |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe | Payment trigger, webhook signature verification |
| `NEXT_PUBLIC_APP_URL` | — | Public URL used to build webhook URLs shown in trigger dialogs |
| `NGROK_URL` | ngrok | Local webhook tunneling, development only |

**Deliberately absent:** a global Google Form webhook secret. Earlier development used one shared `GOOGLE_FORM_WEBHOOK_SECRET` for every workflow — functional, but meant one leak compromised every user's forms at once. It's since been replaced entirely by the per-workflow system described in [Chapter 4](#chapter-4--trust-no-front-door).

See `.env.example` for the full list.

---

## Running It Locally

```bash
git clone https://github.com/banerjeesayantan/deltaflow.git
cd deltaflow
npm install
npx prisma db push
npm run dev
```

Stripe and Google Form triggers additionally require a publicly reachable URL (Vercel deployment or `ngrok`) — neither service can call `localhost`.

---

<div align="center">

**Built by [Sayantan Banerjee](https://github.com/banerjeesayantan)**

I'm looking for AI Full-Stack Engineer / AI Product Engineer roles where the question isn't just *"can you ship a feature,"* but *"can you tell me why it's correct."* If this story was interesting to read, the conversation about how I'd apply the same thinking to your product would be too.

</div>
