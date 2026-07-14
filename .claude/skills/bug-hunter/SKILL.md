---
name: bug-hunter
description: "Hunt a bug the way a senior debugger would: reproduce it on demand before touching any code, read what the error actually says, test hypotheses one at a time, fix the cause instead of the symptom, then prove the fix against the original failure. Exists because the default is the opposite — guess a fix, declare it done, and leave the real bug alive under a patch. MANDATORY TRIGGERS: 'bug hunter', 'run the bug-hunter', 'hunt this bug'. STRONG TRIGGERS (use when something is actually broken): 'it's still broken', 'you said it was fixed and it isn't', 'this keeps happening', 'why is this failing', 'debug this properly', 'find the real cause'. The rule that pays for everything: never fix what you haven't reproduced."
---

# The Bug Hunter

There's a moment in every debugging session where the model says "I can see the likely problem" and reaches for the code. That moment is where debugging goes wrong. What follows is the familiar spiral: a plausible fix, "that should sort it," it doesn't, an apology, a second plausible fix layered on the first, and twenty minutes later the code is worse than when the bug was the only problem.

The spiral isn't a capability failure — it's a procedure failure. Good debugging is a method: make the failure happen on demand, read the evidence, understand the cause, and only then change code. The method is what this skill enforces, and it's most valuable exactly when the model running it isn't the smartest one available.

---

## The one rule: never fix what you haven't reproduced

If you can't make the bug happen on demand, you cannot know you fixed it — you can only know it stopped happening while you were watching, which is not the same thing. A fix without a reproduction is a guess wearing a fix's clothes. So the reproduction comes first, before any code changes, however obvious the problem looks. If it genuinely can't be reproduced, *that* is the current task — not fixing.

---

## When it triggers

- Anything broken: an error, a wrong output, a flow that stopped working.
- The second report of the same bug — "you said this was fixed" fires this skill, with extra suspicion.
- "It works on my machine" / works in one place, fails in another.

## The Method

### 1. Reproduce it, on demand

Get the exact failure happening at will: the command, the click path, the input, the account state. Capture the actual output — the real error text, not a paraphrase of it. This is the moment of temptation ("I can already see it, let me just fix it") — resist it. The reproduction is not overhead; it's the only proof of fix you will ever have.

If it won't reproduce: gather what's needed (exact steps, the input that triggered it, logs from the moment it happened) or add the instrumentation that will catch it next time. Say plainly "not reproduced yet" instead of fixing blind.

### 2. Read what it actually says

The error message, the whole stack trace, the line numbers, the logs. Slowly. The answer is written down more often than anyone believes — the failure mode this step exists to stop is pattern-matching on the *vibe* of an error and jumping to the usual suspect. And when errors cascade, walk back to the **first** one; the loudest error is usually a casualty, not the cause.

### 3. Hypotheses, tested one at a time

State the candidate causes, ranked by likelihood. Then test the cheapest one — as an *experiment*, not a fix: "if this is the cause, I expect to see X" — then look. Two tools do most of the work:

- **Instrument the boundary** — add temporary logging at the border between working-and-broken to see which side of the line the data goes wrong.
- **Bisect the history** — if it used to work, something changed. `git log` and `git diff` since the last known-good state are evidence, not archaeology.

One hypothesis at a time. Changing three things and seeing the bug vanish teaches you nothing and usually plants the next bug.

### 4. Fix the cause, not the symptom

The gate before any fix: **can you explain, in one sentence, why the code produced exactly this wrong behaviour?** "The date was compared as text, so the 10th sorted before the 9th" is an explanation. "I changed the sort and it looks right now" is not. If the fix doesn't follow from the explanation, the cause hasn't been found.

Banned moves, because they hide bugs instead of fixing them: a try/catch that makes the error quiet, a fallback value that masks the failure, special-casing the one input that failed, retrying until it passes.

### 5. Prove it, then check for siblings

Run the reproduction from step 1 — the exact failing case must now pass. Then exercise the things nearest the change, because fixes break neighbours. And before closing: the cause you found usually has siblings — the same mistake pattern elsewhere in the codebase. Look once, now, while you understand it perfectly.

### 6. Leave a trace

Remove the temporary instrumentation. Keep the reproduction as a test if the project has tests. And write one line — in the commit message or the project's CLAUDE.md gotchas — saying what the cause was, so this hunt never has to happen twice.

## The Standards

- No code changed before the bug is reproduced — or before an explicit "can't reproduce, here's what I need" is on the table.
- Every hypothesis stated *before* it's tested; one variable changed at a time.
- The fix is explained cause-first, in a sentence the app's owner would understand.
- The original failing case is re-run and shown passing — "should be fixed" never appears; "the case that failed now passes" does.
- All temporary logging removed; the one-line cause note written.

## The Output

The bug, fixed — plus the short hunt log: the reproduction, the cause in one sentence, what was changed and why, proof the original case passes, and anywhere the same pattern was found lurking.

## The Honest Limits

- Some bugs resist on-demand reproduction — race conditions, environment-specific failures, once-a-week ghosts. The method degrades honestly: reproduce as closely as possible, instrument the gap, and state the confidence level plainly rather than claiming certainty.
- A manual makes a smaller model debug in the right *order*; it doesn't give it a senior debugger's nose for the genuinely weird. The escalation rule: when three hypotheses die in a row, stop — don't thrash. Package the hunt log (reproduction, what was ruled out, the evidence) and take it to the smartest model available. The evidence transfers; that log is exactly what the smarter model needs to finish the job in one pass.
- The skill fixes bugs; it can't fix a spec. If the code does exactly what it was told and the told thing is wrong, that's a decision for the owner, and the skill should say so.
