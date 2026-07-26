# Dream module final audit

Audit date: 2026-07-27

## Verdict

The module is behaviorally verified but is not structurally complete yet.
`dreamController.ts`, `dreamAnalysisGrounding.service.ts`, and
`analyze.service.ts` remain above the agreed size limits. They must be split
before moving to the next module.

## Inventory

| Area | Files | Largest file | Purpose |
| --- | ---: | ---: | --- |
| Controllers | 9 | `dreamController.ts` — 1,036 lines | HTTP mapping and remaining legacy analysis/comment/feedback handlers |
| DTO | 7 | `dreamUpdate.dto.ts` — 69 lines | Request parsing and validation |
| Models | 4 | `Dream.ts` — 236 lines | Dream, symbol and user-profile persistence |
| Content services | 7 | `dreamUpdate.service.ts` — 125 lines | CRUD, narrative versions and AI policy |
| Analysis execution | 6 | `dreamAnalysisQueue.service.ts` — 171 lines | Queue, timing, runtime abort state and reanalysis preparation |
| Analysis retrieval | 9 | `similarDreamRetrieval.service.ts` — 197 lines | Symbol and similar-dream retrieval |
| Analysis reasoning | 5 | `dreamAnalysisGrounding.service.ts` — 977 lines | Grounding, feedback reconciliation and evidence response shaping |
| Analysis orchestration | 1 | `analyze.service.ts` — 931 lines | End-to-end RAG/LLM orchestration |
| Engagement | 1 | `dreamLike.service.ts` — 104 lines | Like mutation, notification and rank update |
| Module tests | 4 | `dreamAnalysisGrounding.test.ts` — 80 lines | Focused Dream contracts |

Total TypeScript lines under `src/modules/dream`: 6,082.

## Remaining oversized boundaries

### `controllers/dreamController.ts` — 1,036 lines

Still owns:

- create Dream;
- comments;
- direct analysis;
- debug RAG;
- rollback persistence;
- background execution;
- queue recovery;
- retry and cancel;
- hypothesis feedback.

Required split:

```text
dreamCreate.controller.ts
dreamComment.controller.ts
dreamAnalysis.controller.ts
dreamFeedback.controller.ts
dreamDebug.controller.ts
analysis/execution/dreamAnalysisLifecycle.service.ts
```

### `analysis/grounding/dreamAnalysisGrounding.service.ts` — 977 lines

Still combines:

- scientific-note response shaping;
- hypothesis reconciliation;
- feedback revision;
- question/rule resolution;
- evidence-needed handling.

Required split by exported capability, while preserving the current response
contract.

### `analysis/orchestration/analyze.service.ts` — 931 lines

Still combines orchestration with context assembly, progress reporting and
result normalization. It needs extraction only after the controller lifecycle
move, because background execution currently depends directly on its progress
callback contract.

## Naming and placement

- `.controller.ts` is used for HTTP/controller boundaries.
- `.service.ts` is used for executable business or infrastructure behavior.
- `.contract.ts` is intentionally used for shared analysis input/output types.
- `dreamAnalysisDispatch.controller.ts` is correctly named after the audit.
- `dreamAnalysisRuntime.service.ts` correctly owns active abort controllers.
- `dreamSymbolObservationSync.service.ts` correctly owns non-fatal secondary
  symbol-index synchronization.

## Verification status

- TypeScript: passed.
- Route contract: 98 feature routes + 1 health route preserved.
- Contract suites: 26/26 passed.
- No current audit result supports deleting a Dream file as unused.

## Gate before the next module

Do not mark Dream complete until:

1. `dreamController.ts` is below 200 lines or removed.
2. each service is below 300 lines, except an explicitly documented data-only
   prompt/contract file;
3. startup recovery imports an execution service, not a controller;
4. all 16 Dream route contracts remain unchanged;
5. retry, cancel, queue recovery, feedback and comment UI checks pass.
