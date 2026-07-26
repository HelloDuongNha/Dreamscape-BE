# Dream module audit

Audit date: 2026-07-27

## Current verdict

The Dream module is structurally complete for the current refactor scope.
HTTP, execution, grounding and orchestration boundaries are separated, and
the public analysis facade keeps the existing progress, cancellation and
response contracts.

## Inventory

| Area | Files | Largest file | Purpose |
| --- | ---: | ---: | --- |
| Controllers | 12 | `dreamFeedback.controller.ts` — 200 lines | One HTTP capability per controller |
| DTO | 7 | `dreamUpdate.dto.ts` — 69 lines | Request parsing and validation |
| Models | 4 | `Dream.ts` — 236 lines | Dream, symbol and profile persistence |
| Content services | 7 | `dreamUpdate.service.ts` — 125 lines | CRUD, versions and AI policy |
| Analysis execution | 10 | `dreamAnalysisQueue.service.ts` — 171 lines | Queue, retry, rollback, recovery and runtime |
| Analysis retrieval | 8 | `similarDreamRetrieval.service.ts` — 197 lines | Symbol and similar-dream retrieval |
| Analysis grounding | 6 | `dreamAnalysisGrounding.service.ts` — 286 lines | Grounding, feedback and scientific-note shaping |
| Analysis orchestration | 8 | `dreamAnalysisOutput.service.ts` — 265 lines | Profile, retrieval, prompt, output and audit orchestration |
| Engagement | 1 | `dreamLike.service.ts` — 104 lines | Like, notification and rank side effects |

Total non-test TypeScript lines under `src/modules/dream`: 6,103.

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

## Verification status

- Backend TypeScript: passed.
- Frontend production build: passed.
- Route contract: 98 feature routes + 1 health route preserved.
- Contract suites: 26/26 passed.
- EN–VI parity and side-effect suites: 14/14 passed.

## Final gate

The module can move to the next module after the user completes the UI
regression checklist: create one analysis, queue a second analysis, cancel and
retry, reload during processing, and answer a generated feedback question.
