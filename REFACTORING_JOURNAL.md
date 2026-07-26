# DreamScape Backend Refactoring Journal

This journal is the source of truth for the behavior-preserving refactor. Each
phase records its scope, locked contracts, unresolved policy questions,
verification results, and the UI checks required before the next phase starts.

## Global safety rules

- Refactor one complete user-facing capability at a time.
- Preserve routes, status codes, response fields, error messages, database
  write order, socket event names, and cancellation/rollback semantics.
- DTO parsers initially reproduce existing coercion and defaults exactly.
- Do not change prompts, AI thresholds, scoring, MongoDB schemas, or indexes
  during structural refactor phases.
- Do not remove code unless imports, callers, routes, and runtime ownership show
  that it is unused or has been fully relocated.
- Run `npm run verify:refactor-baseline` before and after each backend phase.
- Stop after each phase for UI acceptance.

## R1 — Dream read flows

### Scope

- `GET /api/dreams`
- `GET /api/dreams/user/:userId`
- `GET /api/dreams/:id`

### Locked behavior

- Feed pagination defaults to 10, accepts only positive integer limits, caps
  the limit at 100, and silently ignores an invalid or empty cursor.
- Feed order remains `created_at` descending.
- Public feed remains filtered by `is_public: true`.
- User feed remains filtered only by `userId`.
- Author population remains limited to `username display_name avatar`.
- Success and error status codes, messages, response fields, and
  `Cache-Control: no-store` on a successful detail response remain unchanged.
- `mapDreamResponse` remains the single response compatibility mapper.

### Policy questions deliberately not changed in R1

- A user feed currently includes both public and private dreams.
- Dream detail requires authentication but currently has no additional
  owner/privacy check in the handler.

These behaviors may be intentional for profile ownership or may require a
future authorization correction. Changing them during structural refactoring
would be a functional change, so R1 only records them.

### Baseline before edit

- TypeScript: passed.
- Route contract: 98 feature routes + 1 health route preserved.
- Contract suites: 26/26 passed.

### Intended structure

```text
HTTP request
  -> dream read DTO parser
  -> dream read controller
  -> dream read service
  -> mapDreamResponse
  -> unchanged HTTP response
```

### UI acceptance checklist

- Home feed loads the same newest-first dream cards.
- Scrolling loads the next page without duplicates or missing cards.
- A profile loads its dream list and pagination as before.
- Opening a dream shows the same author, content, analysis and counts.
- Opening a completed-analysis notification still opens the correct dream.
- Refreshing an open dream still restores the same detail.

### Implementation result

- Added `dto/dreamRead.dto.ts` for the existing pagination and ObjectId parsing
  contract.
- Added `services/dreamRead.service.ts` for MongoDB read queries and response
  mapping.
- Added `controllers/dreamRead.controller.ts` as the HTTP-only boundary.
- Removed the relocated pagination helper and three read handlers from the
  mixed-responsibility `dreamController.ts`.
- Updated route imports without changing route order or middleware.
- No model, index, frontend, prompt, AI mapper, or authorization behavior was
  changed.

### Verification after edit

- CALM diff impact: low call-graph risk.
- TypeScript: passed.
- Route contract: 98 feature routes + 1 health route preserved.
- Dream route count: 16 unchanged.
- Contract suites: 26/26 passed.
- UI acceptance: pending project-owner verification.

## R3 — Dream analysis architecture and heuristic removal

### Scope

- Dream analysis prompt, validation contract, retrieval, grounding, assembly,
  orchestration, execution and their tests.
- Oracle's dependency on Dream's legacy deterministic question templates.

### Root cause found

The model output was not always the final analysis. A second TypeScript layer
could discard model-authored questions and manufacture replacements for a small
set of narratives (station/train, school, notebook/chase, family/door,
presentation/Moon). Similarity and observed-symbol retrieval also contained
manually enumerated bilingual motifs. These branches made a few fixtures look
stable while making unlisted user wording unpredictable.

### Decisions

- TypeScript owns validation, evidence linkage, deduplication and persistence.
- The analysis model owns interpretation, follow-up wording and practical
  reflections.
- A missing model answer is an analysis failure. The backend must not return a
  synthetic answer copied from a known fixture.
- Rules without a persisted, validated question contract do not receive a
  fabricated vote question. Citation and rule data remain available.
- Lexical and embedding retrieval stay generic. No production similarity score
  is boosted by a hand-written dream motif list.

### Structure after this phase

```text
services/
  __tests__/
  analysis/
    assembly/
    contracts/
    execution/
    grounding/
    orchestration/
    prompts/
    retrieval/
    segmentation/
  content/
  symbolRetrieval.service.ts   # stable public facade
```

### Removed case-specific behavior

- `FEATURE_PATTERNS` and motif-overlap scoring.
- `CANONICAL_ALIASES` and narrative n-gram lookup generation.
- `buildPracticalReflectionsFromHypotheses`.
- Generated feedback sentence prefixes and feedback mutation of model prose.
- Station/train, notebook/chase and family/door interpretation fallbacks.
- Deterministic rule-question reconstruction that replaced model hypotheses.
- Verified-note fallbacks authored around one known dream.
- Translation typo replacements and prose rewrites written for single outputs.
- Model-failure fallback containing a fixed two-train narrative.

### Stable boundaries

- `analysis/prompts/dreamAnalysis.prompt.ts` builds model instructions only.
- `analysis/contracts/dreamAnalysis.contract.ts` validates structure and exact
  narrative evidence without authoring content.
- `analysis/assembly/practicalReflection.service.ts` only validates model
  reflections.
- `analysis/orchestration/analyze.service.ts` coordinates retrieval, generation,
  validation and persistence.
- `analysis/grounding/dreamAnalysisGrounding.service.ts` links accepted content
  to rules and citations.
- Tests live under `services/__tests__`.

### Explicit compatibility boundary

Legacy Oracle vote questions were generated from Dream-specific keyword
templates. Those templates were removed. Existing stored citation questions
remain readable and voteable; a newly materialized rule link receives a vote
question only after Rules V3 persists a validated bilingual question contract.
Until that contract phase is implemented, the citation and rule still render
but the UI must not fabricate a vote question. Dream analysis questions continue
to come from the model and pass the generic contract validator.

### Verification after edit

- TypeScript: passed after every structural move.
- Full contract suite: 26/26 files passed.
- Route contract: 98 feature routes + 1 health route preserved.
- Git whitespace/error check: passed.
- UI acceptance: pending project-owner verification.

## R3 — Dream narrative segmentation and symbol retrieval

### Scope

- Preserve the public `symbolRetrieval.service.ts` import boundary used by dream
  analysis, Oracle grounding, debug RAG, and existing contract tests.
- Separate narrative segmentation, bilingual matching policy, query preparation,
  vector lookup, and candidate ranking into named capabilities.
- Finish the R1/R2 directory boundary by grouping read, create, and narrative
  persistence services under `services/content/`.

### Why the old trigger arrays were not mocks

Phrases such as `woke up inside`, `tỉnh dậy trong`, and `sau khi tỉnh dậy`
were live deterministic domain rules. They decide whether text describes the
dream scene, sleep context, or the user's reaction after waking. Removing them
would change analysis behavior. R3 therefore moves them into an explicit policy
file and preserves matching order instead of replacing them with sample data or
an LLM call.

### Intended structure

```text
symbolRetrieval.service.ts (stable facade)
  -> analysis/segmentation/
       -> dreamSegmentation.policy.ts
       -> dreamSegmentation.service.ts
  -> analysis/retrieval/
       -> symbolMatching.policy.ts
       -> symbolMatching.service.ts
       -> symbolQuery.service.ts
       -> symbolVectorSearch.service.ts
       -> symbolCandidateRanking.service.ts
       -> symbolRetrieval.types.ts

content/
  -> dreamRead.service.ts
  -> dreamCreate.service.ts
  -> dreamNarrative.service.ts
```

Folders describe stable capabilities, not execution positions such as `step1`
or `step2`. This keeps direct imports understandable even if the analysis order
changes later.

### Locked behavior

- The facade exports and return shape remain unchanged.
- Vietnamese diacritic folding, exact token/ngram precedence, symbol aliases,
  vector fallback, score boosts, noise suppression, deduplication, and final
  filtering retain their previous order.
- “Tôi tỉnh dậy trong một căn phòng lạ” and “I woke up inside a strange room”
  remain dream scenes.
- Explicit waking reactions such as “Sau khi tỉnh dậy, tôi thấy tim đập nhanh”
  remain outside the dream narrative.
- No prompts, thresholds, schemas, routes, socket events, or background-job
  lifecycle behavior were changed.
- Contract tests remain permanent regression documentation. They are not
  disposable implementation files.

### Verification after edit

- TypeScript: passed.
- Route contract: 98 feature routes + 1 health route preserved.
- Dream route count: 16 unchanged.
- Contract suites: 26/26 passed.
- Dream analysis grounding assertions: passed, including three new bilingual
  segmentation regressions.
- Similar dream retrieval: 7/7 passed.
- Symbol observation: 10/10 passed.
- CALM post-edit impact could not inspect the nested `BE` Git repository because
  its indexed project root is the non-Git parent workspace; dependency analysis,
  TypeScript, route contracts, contract suites, and the Git diff are used as the
  compensating checks.
- UI acceptance: pending project-owner verification.

## R2 — Create dream

### Scope

- `POST /api/dreams`

### Locked behavior

- The route remains authenticated.
- Missing or whitespace-only content returns status 400 with the same message.
- Content normalization remains NFKC, collapsed whitespace, and trim.
- `mood_tag` trimming and its empty-string default remain unchanged.
- `is_public` defaults to true and continues to determine `privacy` exactly as
  before.
- Timing estimation still completes before the pending dream is written.
- The initial run ID, rollback snapshot, progress metadata, and schema defaults
  remain byte-for-byte equivalent in meaning.
- Background analysis is still scheduled with `setImmediate` and is not awaited
  by the HTTP request.
- The successful response remains status 201 and continues through
  `mapDreamResponse`.

### Boundary decision

`runBackgroundAnalysis` is also used by dream additions and retries. R2 does
not move that runner, its abort-controller map, or rollback logic because doing
so would mix three user-facing capabilities into this phase. The create handler
stays in the existing controller for now, but only coordinates:

```text
parse request
  -> create pending dream
  -> queue existing background runner
  -> map unchanged response
```

The runner and final controller relocation belong to the later dream-analysis
lifecycle phase.

### UI acceptance checklist

- Submitting an empty dream still shows the existing validation behavior.
- Creating a public dream adds one card to the feed.
- Creating a private dream preserves its private state.
- The new card begins in the pending/loading analysis state.
- Exactly one analysis job is shown; no duplicate dream or duplicate job appears.
- Leaving the page and returning keeps the pending dream and its progress.
- Completed analysis still updates the same dream and notification.

### Implementation result

- Added `dto/dreamCreate.dto.ts` for the existing body shape and required-content
  check.
- Added `services/dreamCreate.service.ts` for normalization, timing estimation,
  run identity, rollback metadata, and the single pending-dream write.
- Reduced the create handler from 67 lines to 27 lines without moving the shared
  background runner.
- No frontend, route, model, index, prompt, timing formula, background runner,
  notification, cancel, or rollback behavior was changed.

### Verification after edit

- CALM diff impact: low call-graph risk.
- TypeScript: passed.
- Route contract: 98 feature routes + 1 health route preserved.
- Dream route count: 16 unchanged.
- Contract suites: 26/26 passed.
- UI acceptance: pending project-owner verification.
