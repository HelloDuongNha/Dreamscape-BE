# Rules V3 refactoring audit

## Behavior that must not change

- Source approval starts or reuses the same Rule V3 extraction pipeline used by moderation tools.
- Removing a source invalidates its citations, resets obsolete feedback, and returns affected claims to `[?]`.
- Re-imported EN/VI sources can resolve an equivalent evidence need without relying on exact wording.
- `unresolved`, `candidate_found`, and `resolved` remain distinct lifecycle states.
- Candidate merging, exact-quote verification, score updates, and rollback remain atomic and observable in run history.

## Code standard

- Controllers translate HTTP input/output only.
- The first exported function in an orchestration service reads as the full pipeline.
- Each branch delegates to a named function and edge cases return early.
- Prompt construction, provider runtime, planning, verification, persistence, and presentation stay separate.
- No fixed phrase list may be added merely to pass one example.
- Shared helpers move only when at least two real callers need them.
- Refactoring phases must pass typecheck and the complete contract suite before moving on.

## Audit snapshot

| Area | Current size | Main issue |
| --- | ---: | --- |
| Rules controllers | 135 / 144 / 73 / 177 lines | Every controller now stays below the 200-line hard limit. |
| Full extraction pipeline | 176-line orchestrator; focused services 41–251 lines | Run preparation, batches, persistence, completion/rollback, and summary now have explicit boundaries. |
| Candidate extraction pipeline | 80-line orchestrator; focused services 86–234 lines | Generation, citation/quality verification, and deduplication are separate and contract-tested. |
| Document planning | 21-line profiler; focused services 43–197 lines | Genre, section role, routing, extraction strategy, grouping, and work-unit validation have separate owners. |
| Relationship matching | 222-line relationship service + 99-line semantic helper | Fixture aliases and the one-off realistic/unrealistic branch have been replaced by normalized morphology and constrained semantic similarity. |
| Dream application | 37-line classifier + 133-line signal policy | The pipeline is separate from the ordered, documented application ontology. |
| Candidate presentation | 157 lines | EN/VI explanations now come from structured claim fields instead of four article-specific phrase branches. |
| `services/` | 60 runtime files in 7 ownership folders; 0 flat files and 0 test files | Planning, extraction, evidence, moderation, retrieval, providers, and lifecycle are explicit. |
| `tests/` | 15 contract files in 6 ownership folders | Controller, evidence, extraction, moderation, planning, and retrieval tests no longer sit beside runtime services. |
| Largest runtime service | 290 lines | Every runtime service remains within the 300-line limit. |

## Phases

1. **R3.1 — Controller boundaries**
   - [x] Extract provider runtime from the controller.
   - [x] Move probe, evidence, and candidate presentation mapping into services.
   - [x] Move approval/scoring/embedding into a pipeline service.
   - [x] Split approve, reject, and bulk actions into a moderation controller.
   - [x] Split extraction endpoints from candidate review endpoints.
   - [x] Split preview/dry-run from full extraction lifecycle endpoints.

2. **R3.2 — Extraction orchestration**
   - [x] Keep one readable pipeline entry point.
   - [x] Separate run preparation, batch execution, persistence, merge, completion, and rollback.
   - [x] Keep mutation journal context available to every failure path.
   - [x] Preserve run reuse, attempt history, cancellation, and evidence-gap linking.

3. **R3.3 — Candidate extraction**
   - [x] Separate provider calls and work-unit/batch validation.
   - [x] Separate schema/language/citation and quality verification.
   - [x] Separate in-memory candidate/evidence deduplication.
   - [x] Preserve all 33 extractor/provider assertions and deterministic output.

4. **R3.4 — Service organization**
   - [x] Group files by `extraction`, `planning`, `evidence`, `moderation`, `retrieval`, `providers`, and `lifecycle`.
   - [x] Update imports directly; do not leave compatibility files with only re-exports.
   - [x] Keep prompts and provider schemas outside orchestration services.
   - [x] Move contract tests into `tests/` while preserving ownership subfolders.
   - [x] Delete superseded paths and verify that no flat TypeScript service remains.

5. **R3.5 — Heuristic audit**
   - [x] Split document profiling into genre, section-role, routing, and extraction-strategy services.
   - [x] Split hierarchical planning into grouping, assembly/invariants, and a 43-line pipeline.
   - [x] Remove named people, story details, and other fixture-shaped candidate filters.
   - [x] Replace relationship aliases and the one-off scope-tension branch with normalized semantic features.
   - [x] Remove article-specific candidate explanations and generate EN/VI explanations from structured claims.
   - [x] Move dream-application classification into an ordered signal policy with one small pipeline.
   - [x] Preserve all document, extraction, relationship, retrieval, probe, and scoring contracts.

6. **R3.6 — Final verification**
   - [x] TypeScript typecheck passes with zero errors.
   - [x] Complete contract baseline passes: 26/26 files.
   - [x] Planner regression suite passes: 40/40 assertions.
   - [x] Extractor/provider regression suite passes: 33/33 assertions.
   - [x] `git diff --check` reports no whitespace errors.
   - [x] Record final ownership, largest files, and manual UI lifecycle checklist.

7. **R3.7 — Approval-triggered lifecycle correction**
   - [x] Preserve the reviewed scholarly title after preview promotion or full-text import.
   - [x] Attach approval-triggered runs to the same frontend queue and pin lifecycle as manual runs.
   - [x] Localize queued, running, stopped, failed, and completed pins in EN/VI.
   - [x] Let full extraction decide reuse from its reader/provider fingerprint instead of reusing any latest successful run.
   - [x] Convert academic verification kinds into observable questions instead of exposing raw conditions such as `memory consolidation`.
   - [x] Move all 15 Rules V3 tests out of runtime service/controller folders.
   - [x] Convert legacy quote fixtures to evidence IDs at the test boundary and remove the `chunkId + proposedQuote` branch from production types, validation, and verification.
   - [x] Validate claim type against source evidence rather than the generated claim text; positive findings can no longer pass as null findings.
   - [ ] Complete the manual two-source approval/queue/pin test against a running local app.

8. **R3.8 — Multi-source queue and citation transparency**
   - [x] Serialize Rule V3 extraction in the backend; approving several sources no longer starts several provider pipelines in parallel.
   - [x] Treat only an in-memory active or queued attempt as reusable; an orphaned `pending` run is restarted instead of producing a polling `404`.
   - [x] Keep frontend approval tracking inside the shared academic queue and convert polling failures into visible terminal states.
   - [x] Replace the duplicated citation-excerpt disclosure with the Oracle-written passage that actually uses the argument.
   - [x] Show the documentary base score and user-validation adjustment separately under the single argument score.
   - [x] Remove HTML from localized approval confirmations and render confirmation copy as plain text.
   - [x] Re-run backend typecheck, all 26 contract files, frontend production build, EN/VI parity, and whitespace checks.
   - [ ] Complete the manual three-source approval test and the citation-modal feedback test against an authenticated local app.

## Final ownership map

| Folder | Runtime files | Responsibility |
| --- | ---: | --- |
| `planning` | 14 | Document classification, section routing, evidence batches, hierarchical work units, and previews. |
| `providers` | 7 | Provider selection, prompts, schemas, response validation, and API adapters. |
| `extraction` | 14 | Extraction orchestration, generation, verification, deduplication, persistence, completion, and summaries. |
| `evidence` | 10 | Exact citations, quality policy, entailment, scoring, semantic relationships, and validation feedback. |
| `moderation` | 7 | Candidate presentation, probes, relationships, approval, rejection, and automatic merge behavior. |
| `retrieval` | 6 | Rule retrieval, ranking, feature extraction, and safe dream-application classification. |
| `lifecycle` | 2 | Source invalidation and mutation-journal rollback/recovery. |
| `tests` | 15 | Contract fixtures grouped by controller, evidence, extraction, moderation, planning, and retrieval. |

## Manual UI lifecycle checklist

1. Analyze one EN source and one VI source; confirm run progress and history remain visible.
2. Open a pending argument; confirm evidence excerpt, related evidence needs, score, and question preview still render.
3. Approve all arguments; confirm compatible claims merge automatically without merge-candidate UI.
4. Confirm matched evidence needs move to “source added” and the affected Oracle/Dream citation becomes the highest `[n]`.
5. Answer Yes, No, Not sure, then unselect; confirm the score delta and stored selection update once.
6. Delete the source; confirm citations return to `[?]`, feedback resets, and evidence needs become unresolved without duplicates.
7. Re-import and analyze the same source; confirm matching and questions are rebuilt from current rules rather than restored from deleted records.
8. Cancel and retry an extraction; confirm the old result is restored and no partial rules or evidence remain.
9. Approve two unanalyzed PDF contributions in succession; confirm the first pin runs, the second pin says it is waiting, and each terminal result remains visible for three seconds.
10. Confirm the approved catalog keeps the reviewed article title rather than the original PDF filename.
11. Open the Freud citation and confirm its question describes a recent experience, memory, or emotion without showing the phrase `memory consolidation`.
12. Approve three unanalyzed sources quickly; confirm exactly one Rule V3 pin is active, the other two remain visible in FIFO order, and every source receives a terminal pin.
13. Reload while the second source is waiting; confirm no orphaned run produces a `404` and tracking resumes or safely restarts.
14. Open an Oracle academic citation; confirm each argument disclosure shows the Oracle reasoning passage containing `[n]`, not a second copy of the source excerpt.
15. Confirm the modal labels one total argument score and shows `document evidence` plus the signed `case feedback` adjustment underneath.
