---
name: security-sweep
description: "Check everything you're about to ship the way a security reviewer would — tuned to the holes vibe-coded apps actually get hacked through. Reads the real code (routes, auth checks, database rules, keys, uploads, AI features), builds a ranked list of what an attacker could genuinely do, explains each one in plain English, and offers to fix them worst-first. MANDATORY TRIGGERS: 'security sweep', 'run the security sweep', 'sweep this before I ship'. STRONG TRIGGERS (use when tied to this codebase): 'is this safe to ship', 'could this get hacked', 'check my app for security holes', 'am I leaking anything', 'review this before launch'. Run it before anything real goes live — and again whenever a feature touches money, logins, or user data."
---

# The Security Sweep

Vibe-coded apps don't get hacked by geniuses. They get hacked by people running automated scripts against the same handful of mistakes: a key sitting in the client code, an API route that never checks who's asking, a database that answers anyone. The person who built the app never sees these — the app *works*, and working and safe look identical from the outside.

This skill is the review that catches them. It reads the code the way an attacker reads a target: not "what is this supposed to do" but "what will it do if I ask it something the builder never imagined."

---

## The one rule: every finding is an attack story, not a code smell

A finding only counts if you can say, in one sentence a non-technical person understands, what an attacker could actually do: "anyone can download your whole customer list by changing a number in the URL." Cite the exact file and line. If you can't tell that story, it's not a finding — don't pad the report to look thorough. And the reverse: **zero findings is a valid result.** Say it plainly rather than inventing severity.

---

## When it triggers

- Before anything ships to real users — first deploy, big feature, or "I'm about to share this link."
- Whenever a change touches authentication, payments, uploads, personal data, or an AI feature.
- On request, against a whole existing codebase ("has this been safe all along?").

## The Method

### 1. Map the attack surface (10 minutes, no judgments yet)

Walk the repo and list what's exposed:

- **Every route/endpoint** (`app/api/**`, `pages/api/**`, server actions, edge functions) — and for each: does it check *who* is asking, on the server?
- **Every secret** — grep for keys in the code, in committed `.env` files, and in anything the browser downloads (`NEXT_PUBLIC_*` and client components deserve special suspicion). Check git history for keys that were "removed" but still live in old commits.
- **The database boundary** — Supabase RLS policies, Firebase rules, Prisma queries: is the client trusted to only ask for its own rows?
- **Inputs** — forms, uploads, URL params, webhooks, anything an outsider can put content into.
- **AI features** — anywhere user text reaches a model, especially a model that can call tools or read other users' data.

### 2. Hunt the classic holes, in order of how often they kill

This is the checklist automated attacks run. Check each explicitly, don't sample:

1. **Secrets reachable from the browser** — API keys in client code, keys proxied through an endpoint anyone can call, `.env` committed.
2. **Routes that trust the client** — no server-side auth check; auth checked in the UI but not the API; "the button is hidden" treated as security.
3. **The ID swap (IDOR)** — logged in as user A, request user B's data by changing an id. The single most common vibe-code breach.
4. **Wide-open database rules** — RLS disabled "to make it work", Firebase rules set to `true`, service-role key used where the anon key belongs.
5. **Injection** — SQL built by string concatenation; user content rendered with `dangerouslySetInnerHTML`; user input inside shell commands.
6. **Unverified webhooks** — a Stripe/payment webhook that doesn't check the signature is an endpoint that marks orders paid for anyone who asks.
7. **Uploads taken on trust** — no type/size checks, files served back from your own domain.
8. **No rate limit on the expensive doors** — login, signup, password reset, and anything that spends your API credits.
9. **Admin by obscurity** — an admin page protected only by an unguessable URL or a client-side password check.
10. **Prompt injection with real stakes** — user content flowing into a model that can act (send email, query the database, call tools). If the model can do it, a user's pasted text can ask it to.
11. **Known-vulnerable dependencies** — run `npm audit` (or the ecosystem's equivalent); flag only what's actually exploitable in this app, not every advisory.

### 3. Verify before reporting

For each candidate finding: point at the exact line, and trace the request path that exploits it. If the framework, middleware, or a check elsewhere already blocks it — it's not a finding. Severity is exploitability times blast radius, honestly:

- **Critical** — data breach, money, or account takeover, exploitable today by an outsider.
- **High** — same damage but needs an account, or luck.
- **Medium** — real weakness, contained blast radius.
- **Low** — hardening; note it and move on.

### 4. Report, then offer to fix

Plain English, worst first. No lecture, no filler.

## The Standards

- Every finding: severity, the attack story in one sentence, `file:line`, the fix.
- No finding without a concrete path to exploitation — "best practice" alone doesn't make the report.
- Severity honest — a report where everything is critical is as useless as one where nothing is.
- The fix offer is real: fix them worst-first on the user's yes, one at a time, re-checking each.

## The Output

A ranked table — severity, what an attacker could do, where, the fix — followed by: "Say the word and I'll fix these in order, starting with the worst." After fixes, re-run the relevant checks and show they now fail the attacker.

## The Honest Limits

- This is a careful read of your code, **not a penetration test**. It can't see your hosting dashboard, DNS, or the settings that live outside the repo — and a clean sweep doesn't mean unhackable; it means the common doors are shut.
- Auth logic has subtleties that only real testing catches. For anything holding other people's money or health data, pay a professional as well — this sweep makes that engagement cheaper, not unnecessary.
- Dependency advisories change weekly; a sweep is a snapshot. Re-run it before each meaningful release, not once ever.
- Claude Code ships a built-in `/security-review` that checks the changes on your current branch — use that per change; use this sweep for the whole app, and for a report written for the app's owner rather than its developer. They complement each other, and neither replaces the other.

