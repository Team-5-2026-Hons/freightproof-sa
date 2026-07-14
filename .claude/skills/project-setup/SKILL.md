---
name: project-setup
description: "Start a new project so it doesn't fall apart in month two. Does the first hour properly: version control before the first mistake, secrets out of the code before the first key exists, a CLAUDE.md written at birth, and the thinnest possible version deployed live before any feature gets built. MANDATORY TRIGGERS: 'project setup', 'run project-setup', 'set this project up properly'. STRONG TRIGGERS (use at the start of something new): 'new project', 'let's start building X', 'set up the foundations', 'start this the right way'. Built for the month-two disasters: the lost work, the leaked key, the app that's never actually been deployed."
---

# The Setup

Every abandoned side project dies the same three deaths: work lost because there was no version control ("Claude broke it and I can't get back"), a key leaked because a secret was pasted into the code "just for now", or a launch that never happens because the app has never once been deployed — and on day thirty, deployment turns out to be a crisis instead of a checkbox.

All three are decided in the first hour. That's what this skill does: the first hour, properly, so month two is boring.

---

## The one rule: nothing exists until it's live

The project isn't "set up" when the code runs on your machine — it's set up when a walking skeleton (the thinnest end-to-end slice, even a one-line page) is deployed at a real URL. Deployment problems found on day one are trivial; found on day thirty, with a real app and real users waiting, they're a crisis. Ship the skeleton first. Features come second.

---

## When it triggers

- The start of any new project, before the first feature.
- Rescuing an existing project that skipped these steps ("make this repo safe and deployable") — same method, applied retroactively.

## The Method

### 1. Three questions before any files (one at a time, stop when the picture is clear)

- **What are we building, for whom?** One sentence. It goes in the README and the CLAUDE.md.
- **What's the smallest end-to-end slice?** Not the smallest *feature* — the smallest *path through the whole system*. For most web apps: one page, deployed.
- **Any constraints already fixed?** Stack, hosting, a database that must be used. If none: choose boring defaults and say what they are. Boring is a feature — the well-trodden path is the one AI tools and search results know best.

### 2. Foundations, in this exact order

The order matters — each step protects the next:

1. **`git init` and the first commit** — before anything worth losing exists. From here on, every working state is a save point.
2. **`.gitignore` before the first secret** — env files, `node_modules`, build output, `.DS_Store`. This line must exist *before* the first key does, because a key that touches git history stays in git history.
3. **Secrets scaffolding** — a `.env.local` for real values (ignored), a `.env.example` with placeholder names (committed). The rule that goes with it: a real key never appears in any committed file, ever. "Just for now" is how every leak starts.
4. **A one-paragraph README** — what it is, how to run it. Written now, while it's still true.

### 3. Write the CLAUDE.md at birth

The project's standing orders, from day one: what this is, the stack, the commands, where things live, the don'ts (starting with "never commit env files"). Every AI session after this starts oriented instead of guessing. A project born with a CLAUDE.md drifts less than one that gets it at month three. (Three-tier method, if wanted: [github.com/oliwoodman/claude-md-templates](https://github.com/oliwoodman/claude-md-templates).)

### 4. Deploy the walking skeleton

The thinnest slice, live: a hello-world page on the real host (Vercel or equivalent), connected to the real repo, deploying on every push. If the project has a database, make the skeleton touch it once — one read, displayed on the page — so the *whole* pipe is proven, not just the front of it. This is the step people skip, and it's the whole skill.

### 5. Decide how you'll know things work

Before feature one, set the verify habit: what gets checked before anything is called done? Minimum viable version: the app runs, the main path is clicked through, the build passes. Write it into the CLAUDE.md ("before saying done: ..."). It compounds forever.

### 6. Only now, the first feature

With save points, safe secrets, standing orders, and a live URL — build. Each feature lands on foundations instead of sand.

## The Standards

By the end of setup, all of these are true — check them off explicitly:

- The repo exists, with a clean history and a first commit *before* the first experiment.
- No secret has ever been in a committed file (check, don't assume — including history).
- The app is reachable at a real URL, deploying automatically on push.
- A CLAUDE.md exists with the stack, commands, and don'ts.
- The README says what this is in one paragraph.
- "Done" has a definition the next session can follow.

## The Output

A live URL, a clean repo, the env scaffolding, the CLAUDE.md, and a short written list of what was set up plus the first three next steps. Not a lecture — a project that's ready.

## The Honest Limits

- These defaults are tuned for **small web products** — the thing most people are building. A mobile app, a data pipeline, or anything enterprise changes the checklist; say so and adapt rather than forcing this one.
- Setup can't choose your product, and a perfect first hour saves no project that nobody wants. This buys you the ability to move fast later — it is not the moving.
- "Boring stack" is a default, not a law. If you have real experience somewhere else, that experience beats the default.

