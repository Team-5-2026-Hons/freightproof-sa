---
target: trip detail page timeline (visual hierarchy only)
total_score: 19
max_score: 32
na_heuristics: 5,10
p0_count: 0
p1_count: 1
target_identity: "file:/Users/ciaranformby/dev/freightproof-sa-4/frontend/dispatcher/app/(app)/trips/[id]/page.tsx"
target_fingerprint: "sha256:f36c49e2b45b48c12006cfc023a7d460a524e7abcd45406ddfd28869925fea12"
target_path: /Users/ciaranformby/dev/freightproof-sa-4/frontend/dispatcher/app/(app)/trips/[id]/page.tsx
timestamp: 2026-10-14T10-02-23Z
slug: frontend-dispatcher-app-app-trips-id-page-tsx
---
Method: dual-agent (A: design-review subagent · B: detector/browser subagent). Scope: visual hierarchy only.

## Design Health Score (visual-hierarchy lens)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Verdict lines and header chips read well; the phase nodes are the same amber on 6 of 8 phases |
| 2 | Match system / real world | 3 | SAST times, clock sources and "Driver separated from truck" use dispatcher language |
| 3 | User control and freedom | 3 | Evidence/Minimised and Expand are clear; Expand is an unlabelled icon |
| 4 | Consistency and standards | 2 | Blue means both "time" and "link"; 8 font sizes and 5 weights in the main column; sibling headings differ (14/700 vs 13/800) |
| 5 | Error prevention | n/a | Read-and-review surface; hierarchy lens does not apply |
| 6 | Recognition rather than recall | 2 | The worst phase or finding has to be found by reading every card; nothing ranks them |
| 7 | Flexibility and efficiency | 2 | No worst-first ordering, and no jump from "15 exceptions need review" to the first unreviewed finding |
| 8 | Aesthetic and minimalist design | 2 | Chrome (banner, facts grid, black "Issue audit pack") outweighs the evidence; repeated identical verdict sentences |
| 9 | Error recovery | 2 | The refresh-failure banner is the heaviest block on screen, above the content it concerns |
| 10 | Help and documentation | n/a | No help surface in scope |
| **Total** | | **19/32 (59 %)** | **Acceptable** |

## Design specificity verdict
Mostly authored for this product. The verdict line, findings nested under the confirmation that raised them, clock-source labels and the Recorded/Checked split are evidence-product ideas. The page chrome around them is generic admin: a facts grid, grey cards and a tabbed side panel. It does not yet answer the dispatcher's first question: where did this trip go wrong, and what do I look at first? Deterministic: static detect 0/0 (also with type,layout scope); the live overlay found 12 (10–11 px text ×9, Re-check contrast 2.7:1, 1 unconfirmed nested-cards).

## Priority issues
1. [P1] No severity ranking: every exception phase gets the same amber node and verdict sentence, so nothing is "worst". Fix: a trip-level summary line with a jump to the first unreviewed finding; the strongest node treatment only for phases holding unreviewed or critical findings; a count numeral in the header. Note: reviewer A's 3 px left severity border is the side-tab anti-pattern, so it is rejected. Commands: /impeccable layout, /impeccable clarify.
2. [P2] Chrome outweighs evidence: the banner is the heaviest block, the facts grid sits above the timeline, and the black "Issue audit pack" is the strongest control in the Info panel. Fix: an inline status in the toolbar; demote the audit action to secondary. Command: /impeccable layout.
3. [P2] Blue does double duty: header timestamps are 12/700 `sec` blue (8–11 blue elements in the first viewport against 2–5 amber), the same colour as links and actions. Fix: strong-ink timestamps; keep blue for actions. Command: /impeccable quieter.
4. [P2] Compact rail priorities are inverted: the 12rem time column is about 35–40 % of the row; the group heading (12/600 ink) has the same weight as the finding names (12/600); the phase subline (11/500) is smaller than the verdict (13). Fix: a content-width time column; the heading as a muted label with a hairline; the subline at meta. Command: /impeccable typeset.
5. [P2] Type sprawl: 8 sizes and 5 weights per column, 10 px tabs and badge, inconsistent sibling headings. Fix: the four D37 steps plus h1, weights 400/600/700. Command: /impeccable typeset.

## Persona red flags
- Alex: no worst-first or jump from the chip; "Driver outside precinct" repeats across phases without "×3"; Minimised drops finding names.
- Sam: provenance metadata at 11 px; amber is the only severity cue on the verdict; timestamps and links are told apart by context alone.

## Minor
"No manifest" is tiny grey text although it is an evidence gap; the "Trip timeline" h2 measurement is a false positive (sr-only); the Exceptions panel's per-entry actions (Review / View on map / Show in timeline) make about 6 elements per record.
