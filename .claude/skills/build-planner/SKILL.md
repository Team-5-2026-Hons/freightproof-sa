---
name: build-planner
description: "Turn 'I want to build X' into a staged, written plan that a cheaper model — or a future session that remembers nothing — can execute. Asks the questions that change the build first, offers real options with trade-offs, then slices the work into stages that each end with something you can see working, every step carrying its own verification. MANDATORY TRIGGERS: 'build planner', 'run the build-planner', 'plan this build'. STRONG TRIGGERS (use when a real project is on the table): 'plan out how to build this', 'break this down for me', 'what's the plan for X', 'I want to build X, where do I start', 'write a plan a smaller model can follow'. The point: the smartest model available thinks once, and everything after just executes."
---

# The Build Planner

The expensive part of building isn't the typing — it's the thinking: what to build first, what to skip, what will bite later, how to know each piece works. Most people spend their smartest model on typing and their own guesswork on the thinking. This skill inverts that: the smart model does the thinking *once*, writes it down, and every session after — cheaper model, fresh context, three weeks later — just follows the plan.

---

## The one rule: plan for a reader who can't ask you anything

The plan will be executed by something that wasn't in the room — a cheaper model, a fresh session, you in a month. So every step must carry everything it needs: what to do, what "worked" looks like, and where the edges are. The test for each step: *could someone who's never seen this conversation execute it and know whether they succeeded?* A plan that needs its author present isn't a plan, it's a memory.

---

## When it triggers

- The start of anything bigger than one session: a product, a big feature, a migration, a rebuild.
- "I want to build X" in any form, when X is real.
- Handing work down: "write this up so a cheaper model / a future session can run it."

## The Method

### 1. Ask the questions that change the build (one at a time, six at most)

Not a form — only what actually alters the plan:

- Who is this for, and what's the smallest version that's genuinely useful to them?
- What already exists (code, data, accounts, a half-build to salvage)?
- What's fixed (stack, budget, deadline) and what's open?
- What does done look like — the sentence you'd say when showing it off?
- What's the part *you* are most unsure about? (That's usually where the plan needs its research step.)

Stop early when the answers stop changing the plan.

### 2. Offer real options, then commit

Two or three genuinely different approaches — not one idea and two strawmen — each with its trade-off in one line (fastest to working / most room to grow / cheapest to run). Recommend one and say why. **A plan without a rejected alternative hasn't been thought about, it's been transcribed.** Record the decision and the reason: future sessions inherit the *why*, so they stop relitigating it.

### 3. Slice into stages that each end with something you can SEE

Every stage boundary is something observable working — a page that loads, a flow that completes, a number that appears. Never a stage that's pure plumbing with nothing to show, because invisible progress is where projects stall and morale dies. Stage one is the walking skeleton (thinnest end-to-end path, deployed); each stage after adds one visible capability.

### 4. Write the steps so they execute cold

Within each stage, steps sized for a single session, each carrying four things:

- **Goal** — one sentence.
- **Where** — the files or areas it touches.
- **Verify** — the command to run or flow to click that proves it worked. Every step, no exceptions: a step that can't be verified can't be delegated.
- **The fence** — what this step must NOT touch or turn into. Scope creep is how cheaper models wander; the fence is what keeps them on the path.

### 5. Name the risks with tripwires

The two or three most likely derailers — each with its early-warning sign ("if the API needs approval, you'll know at step 2, not step 9") and the fallback. A risk without a tripwire is a worry; with one, it's managed.

### 6. Write the handoff block

At the top of the plan: the paragraph a fresh session pastes first. What this project is, the approach chosen and why, what's done, what's next. This block is what makes the plan survive context loss — it's the difference between a document and a handover.

## The Standards

- Every step verifiable by *running something*, not by re-reading code.
- No step bigger than a session; no stage without something visible at the end.
- Every decision recorded with its reason; every risk with its tripwire.
- Plain enough that the project's owner can read progress against it without translating.
- The plan lives in the repo as `PLAN.md` — updated as stages complete, so it stays the single source of truth instead of rotting.

## The Output

A `PLAN.md`: handoff block, the chosen approach with the rejected alternatives and why, stages with visible endpoints, steps with goal / where / verify / fence, and the risk list with tripwires. Ready to hand to the next session — whatever model it's running.

## The Honest Limits

- A plan is a hypothesis. Expect to revise it at stage boundaries — the failure isn't revising, it's revising silently. Update the plan, don't abandon it.
- Where the domain is niche, the model will plan confidently and wrong. The plan should say "research this first" at those points rather than guessing — if it doesn't flag any research steps on unfamiliar ground, be suspicious.
- The plan lowers the intelligence needed to execute; it doesn't remove it. A cheaper model with a great plan still makes execution mistakes — that's what each step's verify line is for. And the genuinely hard judgment calls the plan couldn't foresee? Bring those back to the smartest model you can get.
- This is not Claude Code's plan mode. Plan mode designs the next change inside one session and is the right tool for that; this skill writes the plan that outlives sessions — staged, on disk, executable by whoever turns up next. Use plan mode within a step; use this for the build.

