<div align="center">

# DeltaFlow

### AI Workflow Automation: Built Like a Real Product, Not a Tutorial Clone

**[Live Demo](https://deltaflow-lime.vercel.app)** · **[Architecture](#architecture)** · **[Security Engineering](#security-engineering)** · **[Entitlement System](#the-entitlement-system)**

![Next.js](https://img.shields.io/badge/Next.js_15-000000?style=flat&logo=next.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)
![tRPC](https://img.shields.io/badge/tRPC-2596BE?style=flat&logo=trpc&logoColor=white)

</div>

---

## Why This Project Exists

Every company running SaaS products faces the same quiet, expensive problem: **operations teams burn hours every week manually moving data between tools that don't talk to each other** a form submission that should trigger a Slack alert, a payment event that should update a spreadsheet, a lead that should get an AI-drafted follow-up. Zapier and Make built billion-dollar businesses solving exactly this. DeltaFlow is my answer to the same problem, built to demonstrate something more specific than "I can code": **that I understand how a subscription SaaS product actually has to work end to end the pricing model, the billing enforcement, the security boundaries, and the engineering discipline underneath all of it.**

This README isn't a feature list. It's a record of the actual product and engineering decisions behind this build, including the bugs I found in my own early implementation and how I fixed them, because that reasoning is the actual signal worth reading.

---

## What DeltaFlow Does

A visual, node-based workflow builder: connect a **trigger** (form submission, Stripe payment, manual run) to a chain of **actions** (AI reasoning via OpenAI/Anthropic/Gemini, HTTP calls, Slack/Discord notifications), and DeltaFlow runs it reliably in the background — with retries, real-time status, and full execution history.

| | |
|---|---|
| **Triggers** | Manual run · Google Form submission · Stripe events |
| **AI Actions** | OpenAI · Anthropic Claude · Google Gemini |
| **Integrations** | HTTP requests · Slack · Discord |
| **Billing** | Free / Pro / Business tiers, enforced server-side, not just displayed on a pricing page |

---

## The Engineering Story That Matters Most

Most portfolio projects show a pricing page. Very few show that the pricing page actually *works* under the hood that a Free-tier user genuinely cannot exceed their limits no matter how they try, including by going around the UI entirely. That gap between "looks like a SaaS" and "is architected like one" is where I spent most of my engineering effort on this project, and it's the part I'd most want to walk through in an interview.

### The bug I found in my own first implementation

My initial subscription check was a single all-or-nothing gate: *any* active paid subscription unlocked workflow/credential creation, and having none blocked it completely. That meant my own advertised Free plan: "5 active workflows" was silently unusable in production. I only caught it because I deliberately tested against a production build instead of trusting my local dev environment, where the check was bypassed entirely.

**The fix:** I separated *authentication* from *authorization*. A new `entitledProcedure` middleware attaches the user's real plan to the request resolved server-side from Polar, never trusted from the client without gating access itself. Each action then makes its own explicit entitlement decision (`assertWorkflowEntitlement`, `assertCredentialEntitlement`, `tryConsumeExecution`), so Free genuinely means "usable, with real limits," not "locked out."

### The race condition I fixed before it could ship

Naive quota enforcement, count existing rows, compare to a limit, then create, has a textbook concurrency bug: two simultaneous requests can both read "499 of 500," both pass the check, and both get accepted. I replaced that with a single atomic SQL statement:

```sql
UPDATE "usage_counter"
SET count = count + 1
WHERE "userId" = $1 AND period = $2 AND count < $3
```

Postgres's row-level locking during the `UPDATE` makes this safe under concurrency by construction the second simultaneous request's `WHERE` clause simply matches zero rows once the first has committed, without needing application-level locking or retries.

### The security hole in my own webhook routes

My Google Form and Stripe webhook endpoints originally accepted *any* POST request with no verification at all meaning anyone who found or guessed a workflow ID could trigger someone else's paid AI workflow and run up their usage. I fixed both, differently, because they have genuinely different threat models:

- **Stripe** provides cryptographic signatures — I verify `stripe-signature` against `constructEvent()`, reading the raw request body (parsing it as JSON first, a common mistake, silently breaks signature verification).
- **Google Forms has no equivalent signing mechanism**, so I designed a **per-workflow** secret system instead of a single global one: each workflow gets its own cryptographically random, encrypted-at-rest secret, compared using `timingSafeEqual` (constant-time, so response latency can't leak information about the correct value character-by-character). This means a leaked secret compromises exactly one workflow — not the entire application.

---

## Architecture

```
Next.js 15 (App Router)  →  tRPC  →  Business logic + entitlement checks  →  Prisma  →  PostgreSQL (Neon)
```

**Every execution path — manual button, Google Form webhook, Stripe webhook — funnels through one shared function before an execution is ever created:**

```
 Manual "Run" ──────┐
 Google Form ───────┼──►  sendWorkflowExecution()
 Stripe event ───────┘            │
                                   ▼
                        tryConsumeExecution()   ← atomic quota gate
                                   │
                                   ▼
                                Inngest
                                   │
                                   ▼
                   topologicalSort(nodes, connections)
                                   │
                                   ▼
                 Executor registry → OpenAI / Anthropic / Gemini /
                                      HTTP / Slack / Discord
```

This was a deliberate choice, not an accident: rather than duplicating a quota check in three separate call sites and risking one being forgotten later, every trigger type depends on the same gate. One place to get right, one place to audit.

---

## The Entitlement System

| Limit | Free | Pro | Business |
|---|---:|---:|---:|
| Active workflows | 5 | Unlimited | Unlimited |
| Executions / month | 500 | 20,000 | 100,000 |
| Stored credentials | 3 | 100 | Unlimited |

Enforced identically regardless of *how* a request arrives — tRPC mutation, Stripe webhook, or Google Form webhook — and resolved from Polar's actual subscription state on the server, never from anything the client claims. If Polar is briefly unreachable, the system fails closed to the Free tier rather than ever silently granting unpaid access.

---

## Security Engineering

- **Ownership enforced at the query level**, not in application code after the fact: every read/write includes `userId: ctx.auth.user.id` directly in the Prisma `where` clause, so a user cannot access another user's data by guessing an ID — the row simply doesn't match.
- **Credentials and webhook secrets encrypted at rest**, never stored in plaintext.
- **Constant-time comparison** (`timingSafeEqual`) for Google Form webhook secret verification, closing a subtle timing side-channel a naive `===` comparison would leave open.
- **Dependency vulnerabilities reviewed** via `npm audit`; non-breaking fixes applied immediately, major-version upgrades (Next.js, AI SDK, Sentry) deliberately deferred rather than risked pre-launch — a documented trade-off, not an oversight.

---

## Tech Stack

**Framework & Language** — Next.js 15 (App Router, Turbopack), TypeScript
**API Layer** — tRPC, TanStack Query
**Database** — PostgreSQL (Neon), Prisma ORM
**Auth** — Better Auth (email/password, GitHub, Google OAuth)
**Billing** — Polar (checkout, customer portal, subscription state)
**Background Jobs** — Inngest (step functions, automatic retries, real-time pub/sub)
**Workflow Canvas** — React Flow
**AI Providers** — OpenAI, Anthropic, Google Gemini (via Vercel AI SDK)
**UI** — Tailwind CSS v4, shadcn/ui
**Monitoring** — Sentry

---

## What I'd Build Next

Being specific about what's incomplete is more useful to a reader than pretending otherwise:

- **Cache plan state locally**, synced via a Polar webhook handler, so entitlement checks stop depending on a live external API call for every request — the natural next step for real production scale.
- **Reconcile Prisma migration history with actual schema state.** Early schema changes were applied via `db push` before migration discipline was fully established; the migration history and live database have since diverged. `db push` is used for schema changes in the meantime — a deliberate short-term choice, with cleaning up proper migration history as a follow-up task.
- **Automated test suite** for the entitlement and webhook-auth logic specifically — currently verified through deliberate manual testing (including temporarily lowering plan limits to confirm the quota system blocks exactly at the boundary, not just that it compiles).
- **Team workspaces and role-based access** for the Business tier — designed conceptually, not yet built.

---

## Running It Locally

```bash
git clone https://github.com/banerjeesayantan/deltaflow.git
cd deltaflow
npm install
npx prisma db push
npm run dev
```

See `.env.example` for required environment variables (database, auth, Polar, Inngest, AI provider keys).

---

<div align="center">

**Built by [Sayantan Banerjee](https://github.com/banerjeesayantan)** — looking for AI Full-Stack Engineer / AI Product Engineer roles where business judgment and engineering depth both matter.

</div>
