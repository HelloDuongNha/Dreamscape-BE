# Dream module audit

Audit date: 2026-07-28

## Current verdict

The Dream module is structurally complete for the current refactor scope.
Controllers, DTOs, content services, analysis execution, retrieval, grounding,
orchestration, prompts and persistence models have separate boundaries.

The citation lifecycle now uses the same structured claim contract as Oracle:
an unsupported research claim is stored as `[?]`, an approved source replaces
it with a numbered citation and one source-level verification question, and
source deletion restores `[?]`, removes that question and rolls back its vote.

## Inventory

| Area | Files | Lines | Largest file |
| --- | ---: | ---: | --- |
| Controllers | 12 | 776 | `dreamAnalysis.controller.ts` — 122 |
| DTO | 9 | 357 | `dreamUpdate.dto.ts` — 69 |
| Models | 4 | 365 | `Dream.ts` — 241 |
| Content services | 7 | 502 | `dreamUpdate.service.ts` — 125 |
| Analysis execution | 14 | 1,333 | `dreamAnalysisRunner.service.ts` — 238 |
| Analysis retrieval | 8 | 715 | `similarDreamRetrieval.service.ts` — 186 |
| Analysis grounding | 11 | 1,673 | `dreamAnalysisResponse.service.ts` — 248 |
| Analysis orchestration | 9 | 1,100 | `analyze.service.ts` — 246 |
| Continuation creation | 1 | 150 | `dreamContinuation.service.ts` — 150 |
| Prompts | 2 | 274 | `dreamAnalysis.prompt.ts` — 201 |
| Contracts | 1 | 129 | `dreamAnalysis.contract.ts` — 129 |
| Segmentation and assembly | 2 | 56 | `dreamSegmentation.service.ts` — 30 |
| Engagement | 1 | 104 | `dreamLike.service.ts` — 104 |

Total non-test TypeScript lines under `src/modules/dream`: 7,550.
Every controller stays below 150 lines and every service stays below 300 lines.

## Completed boundaries

- The former fat Dream controller no longer exists.
- All 17 Dream routes keep their method, path and middleware order.
- Each controller handles one HTTP capability and delegates business logic.
- Request parsing for create, read, update, delete, privacy, like, AI policy,
  analysis and feedback lives in DTO files.
- Queue, retry, cancellation, rollback, restart recovery and continuation jobs
  are separated from HTTP controllers.
- The analysis runner delegates its immutable completion update to
  `dreamAnalysisCompletion.service.ts`; the runner now only owns run fencing,
  execution, commit and finalization.
- One per-user FIFO queue schedules analysis and continuation work.
- Retrieval, prompts, model calls, output validation and citation grounding are
  separate pipeline steps.
- Current and historical analyses use the same citation binding shape.
- Source removal invalidates only claims backed by that source and preserves
  citations backed by other sources.
- Evidence Needed capture treats the structured Dream ledger as authoritative;
  legacy prose scanning is used only when no ledger exists.
- Rule feedback is removed and scores are recomputed when its Dream or source is
  deleted.
- Frontend citation markers, source questions and EN–VI labels share the Oracle
  presentation contract.

## Verification status

- Backend TypeScript: passed.
- Route contract: 98 feature routes + 1 health route passed.
- Backend contract baseline: 34/34 files passed.
- Dream Evidence Needed ledger regression: 3/3 passed.
- Frontend production build: passed.
- EN–VI parity and side effects: 14/14 groups, 1,500/1,500 keys.
- Oracle/Dream shared shell contract: 17/17 passed.
- Backend and frontend `git diff --check`: passed.

## Persisted-data audit

The read-only database audit inspected 43 completed Dreams. All use the current
citation contract, so the migration dry-run found zero legacy candidates and
made zero writes.

- 14 unresolved bindings and zero resolved bindings are internally consistent.
- No resolved binding is missing a source, rule, evidence, citation index or
  verification key.
- No unresolved binding retains stale resolved fields.
- No marker, citation, question or feedback is out of sync with its binding.
- Seven Evidence Needed records reference Dreams, with zero orphan Dream IDs.

The migration command remains dry-run by default. Applying migration or model
reanalysis still requires an explicit operator flag.

## UI regression gate

1. Analyze a Dream with no supporting source: the claim shows `[?]` and no
   source question.
2. Approve a matching source: the same claim gains the next citation number and
   one unanswered question.
3. Add a second supporting source: its claim gains another number and another
   question; claims sharing one source still share one question.
4. Delete one source: only its number returns to `[?]`, its question disappears
   and its vote no longer contributes to the rule score.
5. Re-add a matching source: the citation and question return with no previous
   answer selected.
6. Open a historical Dream version: its matching citations are correct and
   feedback controls remain read-only.
7. Repeat the checks in Vietnamese and English.
