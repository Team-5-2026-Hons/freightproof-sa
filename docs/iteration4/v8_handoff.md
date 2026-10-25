# Handoff: Iteration 4 document, v8 → final

**File:** `docs/iteration4/INF4027W_Team05_Iteration4_Document2026_v8.docx` (saved 24 Oct 2026).
**Rules:** the document is at most 70 pages, in Calibri 11 with 1.18 line spacing on A4. v7 rendered at 66 pages in Word; v8 adds the Jira charts, a retrospective table and about 300 words of UI rationale, so its page count has not been checked yet. Marks out of 50: Background/objectives 8, UML 12, Testing 8, UI mock-ups 12, Scrum 10. The user log is mandatory.

## Decisions already made (do not reopen)

- **Iteration 4 is a delta document.** Anything unchanged since Iteration 3 is cited as (Team05, 2026b, §x) rather than repeated. Background, business problems, objectives and traceability stay in full.
- **Sprint metrics follow Jira:** Sprint 9 is 118 of 118 points, Iteration 4 is 161 points, and Table 38 shows points per member. FP-278, FP-297 and FP-293 are "Closed in Jira; not in the release (§5.4)". §5.4 must keep stating that these behaviours are not in the build.
- **§8 UI:** §8.1 gives the general approach and Table 27. §8.2–§8.8 each have a short design-reasoning paragraph, as Iteration 3 feedback asked. Screenshots and captions stay.
- **Jira charts:** Figures 21 (Sprint 8 burndown), 24 (Sprint 9 burndown) and 25 (velocity) are Jira screenshots. A note under Table 37 explains why Jira's commitment figures differ from the table's.
- **Retrospectives:** Table 34 (Sprint 8) and Table 36 (Sprint 9). The team must confirm Table 36 reflects what was actually discussed; it was drafted from Jira data.
- **New narratives:** Tables 20–22 (TLM 1.14/CC 1.12 driver substitution, TLM 1.15 incidents, TLM 1.16 assistant) were written from the code. The team should still review them.

## Still to do

### A. Quick edits (an AI session can do these)

1. **Restore Figure 2b**, "Iteration 4 additions to the analysis class diagram". Figure 2's legend points to it, and Figure 2 lacks the AuditPack, Incident, CostProfile and DriverSubstitution classes. The image is `word/media/image16.png` in the **v6** docx, shown at 16.6 × 7.9 cm under Figure 2. Restore the sentence before it: "Figure 2b shows the classes new in Iteration 4 and the existing classes they attach to; Figure 2 shows the full model." Name the new caption "Figure 2b" so no other figure numbers change.
2. **Restore risk R-22** in Table 8. It was lost when v7 was saved in Word, and Table 10 still cites it. The row is "R-22 · Partner credentials never arrive → integrations simulated at the final demonstration · 5×3=15 · – · Realised · Realistic mock feeds; one switch per integration · partner status · state the limitation; show the switch · Ciaran Formby". Leave out the Category column, which was removed from the table. Check the table still fits on one landscape page.
3. **Appendix A (Table 39) column widths.** The table grid (1148/1326/7154) disagrees with the cell widths (1700/4200/3700), so the table collapses across about 6 pages. Set the grid and every cell to roughly 1.1 / 2.9 / 2.6 inches (about 1584 / 4176 / 3744 twips, totalling ≤ 9638), and switch off AutoFit with `tblLayout` set to fixed. This should recover 2–3 pages.
4. Text fixes:
   - Table 35, FP-303 outcome: "Submission preparation" → "Done".
   - §10.4: "Across comparable sprints the team completed about 6.5 points per sprint day" → **6.2**, since Sprints 2, 5, 6 and 7 give 312 ÷ 50.
   - Table 12, TLM 1.3 row: remove "last update … location check". The list shows phase, plan position and unreviewed exceptions; last update and location check are on the timeline (§8.2).
   - Table 6, SO-8: "A dispatcher issues an audit pack" → "An Admin-Dispatcher issues …" (BR-9).
   - §10.1: replace "every story was estimated in Fibonacci story points and assigned before work started" with the intended process plus the real deviations. Points were mostly Fibonacci, though FP-281 is 11, and some work was ticketed after it started (see the §10.5 lessons).
   - §9.3: cite the load-test report `docs/testing/fp-299-database-timeout-load.md`, which is on `origin/main` and dated 21 Oct 2026.
5. **Driver screenshots (§8.6)**, once the files are in `docs/iteration4/driver-screens/`. Lay them out in rows of three phone screens about 5 cm wide, using borderless tables like the existing Figure 15/16 table. Give each its own caption, then renumber the later figures and every in-text reference to them. Suggested row 1: Arrival seal reading (fills the empty Figure 14), driver handover/substitution, exception with photos. Row 2: the existing QR code and receiver-confirmed screens, plus the receiver's own screen or the retained-evidence list. Use demonstration data only, with no real IDs.

### B. Team actions (people, not AI)

6. **User log (Appendix C).** Fill in Table 41 (scores out of 5 for Coding, Documentation, Presentation, Research, Meeting minutes and Communication) and Table 42 (each log signed by the other three members). Expand each member's description to cover all six categories, about 6 lines each. Chiko's entry should credit the FP-299 load test.
7. **Deployment diagram (Figure 7)** says "Railway" and "Supabase af-south-1 (Cape Town)", but §7.1 and Table 24 say Fly.io. The latest `main` commit sets Fly's primary region to Stockholm (arn) because Supabase is in eu-north-1. Confirm the real host and region, fix the diagram source, and check Figure 1's storage label too. Any POPIA or af-south-1 claims in the text must match.
8. **Use-case diagram (Figure 3, Thomas).** Give the audit-pack recipient a separate **View/Verify Audit Pack** use case, instead of linking the recipient to Issue an Audit Pack through «include».
9. **Missing figures:** 19 (the client portal showing an actual verification result), 22 (Sprint 8 task board) and 23 (Sprint 9 task board). For the boards, a crop of the Done column is enough.
10. **ERD (Figure 6)** is still the Iteration 3 version. Add the 21 tables new since Iteration 3, or draw a delta ERD showing those tables and their links to the existing ones:
    - audit_packs, audit_pack_access_events, audit_pack_email_codes
    - cost_profiles
    - the 7 driver_substitution_* tables
    - late_driver_evidence, late_driver_evidence_artifacts
    - evidence_anchor_events, exception_artifacts, driver_push_tokens
    - incidents, incident_declarations, incident_exceptions, incident_parcels, incident_updates
11. **Code to submit:** make sure the submitted branch includes `origin/main`, which has the FP-299 report and `asyncpg>=0.32.0`. The local `dev` checkout was 18 commits behind. If possible, add a CI or test-run screenshot for the final commit next to Figure 20, which is dated 19 Oct.
12. **Final export:** open the docx in Word, use Update Field on the TOC, check it is ≤ 70 pages, then export the PDF.

## How v7/v8 were edited (if an AI continues)

- Edit the docx XML directly with Python and lxml, so all v6 styles are kept. Unzip to a working folder, `merge_runs.py`, edit, zip, then run `validate.py --original`. Both scripts are in the docx skill.
- **After `merge_runs` on a Word-saved file,** split any run that holds `fldChar`/`instrText` alongside other content back into separate runs. Otherwise the TOC page fields break for some readers.
- **Copied paragraphs and tables must not reuse `w14:paraId`:** remove the attribute or give it a new value. New drawings need a unique `wp:docPr id` and their own relationship id.
- **Captions and references are plain typed text, not SEQ fields.** After adding or removing a figure or table, renumber with a regex over every `w:t`, and skip citations of earlier iterations ("2026b, Table 37").
- **Never overwrite a file that is open in Word.** Check for a `~$…` lock file, and write a new version (v9) if one exists.
- Word automation from the shell is blocked by macOS, so ask Ciaran to export a PDF to check pages. Page fill can be measured with PyMuPDF (`pip install --user pymupdf`).
