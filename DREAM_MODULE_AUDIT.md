# Dream module audit

Audit date: 2026-07-27

## Current verdict

The HTTP and lifecycle boundaries are complete and behaviorally verified.
Two reasoning services remain above the agreed 300-line service limit, so the
Dream module is not yet marked structurally complete.

## Inventory

| Area | Files | Largest file | Purpose |
| --- | ---: | ---: | --- |
| Controllers | 12 | `dreamFeedback.controller.ts` — 200 lines | One HTTP capability per controller |
| DTO | 7 | `dreamUpdate.dto.ts` — 69 lines | Request parsing and validation |
| Models | 4 | `Dream.ts` — 236 lines | Dream, symbol and profile persistence |
| Content services | 7 | `dreamUpdate.service.ts` — 125 lines | CRUD, versions and AI policy |
| Analysis execution | 10 | `dreamAnalysisQueue.service.ts` — 171 lines | Queue, retry, rollback, recovery and runtime |
| Analysis retrieval | 8 | `similarDreamRetrieval.service.ts` — 197 lines | Symbol and similar-dream retrieval |
| Analysis grounding | 1 | `dreamAnalysisGrounding.service.ts` — 977 lines | Grounding, feedback and scientific-note shaping |
| Analysis orchestration | 1 | `analyze.service.ts` — 931 lines | End-to-end RAG and LLM orchestration |
| Engagement | 1 | `dreamLike.service.ts` — 104 lines | Like, notification and rank side effects |

Total non-test TypeScript lines under `src/modules/dream`: 5,932.

## Completed boundaries

- The old 1,036-line `dreamController.ts` no longer exists.
- All 16 Dream routes keep the same method, path and middleware order.
- Retry, cancellation, rollback, queue recovery and background execution no
  longer depend on a controller.
- Server startup imports recovery and execution services directly.
- Create, comments, read, update, delete, privacy, likes, AI policy, direct
  analysis, retry/cancel, diagnostics and feedback have separate controllers.
- Pin restoration preserves both progress from the active run and original task
  order after reload.

## Remaining extraction

### Grounding

Split `dreamAnalysisGrounding.service.ts` by existing capability, not by
individual test case:

1. text/title grounding;
2. feedback revision and case conclusion;
3. scientific-note construction and enrichment;
4. contextual motif and personal-pattern projection.

The current exported API must remain available through a small barrel service
until callers are migrated.

### Orchestration

Split `analyze.service.ts` around stable data boundaries:

1. request/context preparation;
2. retrieval plan execution;
3. provider generation;
4. deterministic result assembly and validation.

`runDreamAnalysis` remains the public facade so progress callbacks, error
mapping and background execution do not change.

## Verification status

- Backend TypeScript: passed.
- Frontend production build: passed.
- Route contract: 98 feature routes + 1 health route preserved.
- Contract suites: 26/26 passed.
- EN–VI parity and side-effect suites: 14/14 passed.

## Final gate

Do not move to the next module until:

1. both remaining reasoning services are below 300 lines;
2. `dreamFeedback.controller.ts` is at or below 200 lines;
3. retry/cancel/queue UI checks pass after a real page reload;
4. all verification results above remain green.
