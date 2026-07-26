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

## R3 follow-up — Close retrieval boundary and remove prose padding

- Moved the public symbol retrieval coordinator from the `services/` root into
  `analysis/retrieval/`; all callers now use the capability-owned path.
- Removed deterministic `core_analysis` padding that repeated an uncertainty
  sentence and copied interpretation-card reasoning into the main analysis.
- Strengthened the model contract so the main analysis follows one central
  sequence, adds insight beyond paraphrase, addresses the reader directly, and
  states its uncertainty boundary once instead of in every section.
- TypeScript passed, 98 feature routes plus the health route remained unchanged,
  and all 26 contract files passed.

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
      symbolRetrieval.service.ts # public retrieval coordinator
    segmentation/
  content/
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

- Preserve the `symbolRetrieval.service.ts` exports and return contract while
  relocating the coordinator beside the retrieval capabilities it composes.
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
analysis/retrieval/symbolRetrieval.service.ts (public coordinator)
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

## R4 — Update dream content

> Superseded by R5. The structural R4 contract intentionally kept analysis
> unchanged; UI acceptance showed that this produced a context/analysis
> mismatch, so R5 promotes editing to explicit versioned behavior.

### Scope

- `PUT /api/dreams/:id`

### Locked behavior

- Only the dream owner can update its content.
- An invalid dream ID still returns status 400 with `Invalid dreamId.`.
- Missing or whitespace-only content still returns status 400 with
  `content is required.`.
- A missing dream or a dream owned by another account still returns status 403
  with `Not found or access denied.`.
- The previous content is appended to `edit_history` before it is replaced.
- New content keeps the existing NFKC/whitespace normalization and content-hash
  calculation.
- The successful response remains status 200 and uses `mapDreamResponse`.
- Editing content intentionally does not restart dream analysis in this
  behavior-preserving phase. Existing analysis therefore remains unchanged.
- The backend still accepts any non-empty content. The Swagger `maxLength`
  annotation is not treated as a new runtime restriction in this phase.

### Implementation result

- Added `dto/dreamUpdate.dto.ts` as the request boundary for dream ID and
  required-content validation.
- Added `services/content/dreamUpdate.service.ts` for the owner-scoped lookup,
  edit-history snapshot, normalization, hashing, save, and response mapping.
- Added `controllers/dreamUpdate.controller.ts` as a 35-line HTTP adapter.
- Removed the update handler from the mixed `dreamController.ts`.
- Kept the public route and its middleware order unchanged.

### Request flow

```text
PUT /api/dreams/:id
  -> parse and validate request DTO
  -> find dream by ID + authenticated owner
  -> archive previous content
  -> normalize and hash new content
  -> save once
  -> return the existing response shape
```

### UI acceptance checklist

- The owner can open Edit from the dream card and sees the current content
  prefilled.
- Cancel closes editing without changing the card.
- Save updates the same card immediately without a refresh or duplicate card.
- The Edited indicator/history still appears after saving.
- Leading, trailing, and repeated whitespace is normalized as before.
- Empty content cannot be saved.
- Another account cannot edit the dream.
- The existing analysis remains visible and unchanged after the content edit;
  automatic reanalysis is a separate product decision, not part of R4.

### Verification after edit

- TypeScript: passed.
- Route contract: 98 feature routes + 1 health route preserved.
- Dream route count: 16 unchanged.
- Contract suites: 26/26 passed.
- UI acceptance: pending project-owner verification.

## R5 — Versioned dream context

### Product behavior

- Editing the base narrative snapshots the complete visible context: original
  text, ordered additions, analysis result/status, retrieval context, analysis
  metadata, mood, and hypothesis feedback.
- The edited narrative becomes the new current version and is queued for a
  fresh analysis. Stale analysis is never presented as belonging to the new
  text.
- Historical versions are read-only. Their content, additions, and analysis
  move together through one version navigator.
- Additions in the current version can be appended, edited, or deleted inside
  one unified edit draft. Saving the draft snapshots and reanalyzes once.
- Editing/deleting an addition does not mutate an immutable historical
  snapshot.
- Legacy `edit_history` entries remain readable. Because older code stored only
  content, the API marks them `isLegacyPartial` and the UI explains that their
  additions/analysis cannot be reconstructed.

### API and storage

- `PUT /api/dreams/:id` accepts the base content plus the complete ordered
  additions draft, then returns 202 with one persistent queued analysis run.
- Per-addition mutation routes were deliberately removed after the unified
  editor made them redundant; there remains one contextual-write pipeline.
- The former append-only `POST /:id/additions` route was also removed after all
  frontend addition editing moved into the unified context draft.
- `edit_history` remains lightweight in the response for compatibility.
- The response adds `versions`; each entry is a coherent display snapshot and
  exactly one entry is marked `isCurrent`.
- Contextual edits use the existing per-user fair queue, run ID, commit fence,
  cancellation, failure, timing, polling, and notification pipeline.

### Frontend behavior

- Replacing a Dream response preserves the populated author, fixing the
  avatar/username disappearance before refresh.
- The detail modal uses one `displayedVersion` for content, additions, status,
  mood, and Oracle analysis.
- The `‹ current/total ›` navigator follows the familiar Oracle branch
  navigation pattern and sits below the complete context like pagination.
- Cards remain read-only; their menu opens the detail modal directly in unified
  edit mode.
- The modal has the same owner menu as the card.
- Only unified edit mode exposes addition inputs and red remove controls.
- Addition removal edits the local draft and uses the shared confirmation
  component; one Save applies every change.
- All new labels are available in Vietnamese and English.

### Verification

- Backend TypeScript: passed.
- Frontend production build (`vue-tsc -b && vite build`): passed.
- Route contract intentionally contracts from 98 to 97 feature routes after
  removing the redundant append-only route; passed.
- Existing contract suites: 26/26 passed.
- Git diff whitespace checks: passed.
- UI acceptance: pending project-owner verification.

## R6 — Per-post AI analysis policy

### Product behavior

- The composer exposes one AI-analysis switch beside post visibility. Posting
  with the switch off persists the post immediately without creating a timing
  estimate, queue entry, background run, rollback snapshot, or progress tracker.
- A disabled post renders an explicit disabled state instead of an empty or
  failed Oracle panel.
- The owner menu can enable or disable analysis from both the feed card and the
  detail modal.
- Disabling a post with an existing result requires an explicit choice:
  retaining the result makes a later enable operation instantaneous, while
  deleting it makes the next enable operation create a fresh queued analysis.
- Disabling a pending run clears its persisted run identity and aborts the
  active execution. A late worker cannot commit into the disabled post.
- `Analyze again` is visible only while AI analysis is enabled.
- Editing a disabled post keeps analysis disabled and clears any stale current
  result; immutable historical version snapshots remain readable.

### API and storage

- `POST /api/dreams` accepts optional `ai_analysis_enabled`; omission preserves
  the former default of enabled analysis.
- `PATCH /api/dreams/:id/ai-analysis` is owner-scoped and accepts
  `{ enabled, resultPolicy?: "keep" | "delete" }`.
- `ai_analysis_enabled` is the durable user preference. `ai_status: "disabled"`
  is the corresponding lifecycle state.
- Enabling without a retained result reuses the established fair queue,
  persistent run ID, timing, rollback, polling, and notification pipeline.
- The controller only parses HTTP input, delegates policy, aborts an old run
  when required, and dispatches a prepared analysis. Result lifecycle decisions
  remain in `dreamAiPolicy.service.ts`.

### Shared frontend behavior

- `AppSwitch` is the common accessible switch component used by the composer.
- `AppConfirm` supports a neutral secondary action so the keep/delete choice
  remains one confirmation dialog rather than two unrelated prompts.
- Feed and detail views call the same Pinia action and backend policy endpoint;
  neither view reconstructs the lifecycle locally.
- All new interface text has Vietnamese and English catalog entries.

### Verification

- Project-owner UI acceptance: passed.
- Backend TypeScript: passed.
- Frontend production build: passed.
- Route contract: 98 feature routes + 1 health route preserved after adding the
  explicit AI-policy endpoint.
- Existing contract suites: 26/26 passed.
- EN/VI parity and message compilation: 14/14 passed with 1,271 keys per locale.
- Git whitespace/error checks: passed.

## R7 — Delete dream

### Scope and locked behavior

- `DELETE /api/dreams/:id` remains authenticated and owner-scoped.
- An invalid ID still returns 400 with `Invalid dreamId.`.
- A missing dream or non-owner request still returns 403 with
  `Not found or access denied.`.
- Writes remain sequential and in their former order: delete the owned dream,
  then its comments, then notifications linked by `postId`.
- Success remains 200 with `Dream deleted.`; unexpected failures retain the
  existing 500 response shape.
- This structural phase deliberately does not add a new cascade policy for
  other collections. Such a data-retention decision requires a separate audit
  and migration plan.

### Structure

```text
DELETE /api/dreams/:id
  -> dreamDelete.dto.ts
  -> dreamDelete.controller.ts
  -> dreamDelete.service.ts
  -> Dream, Comment, Notification
```

- The DTO owns ObjectId parsing only.
- The service owns the owner-scoped write and established cascade order.
- The controller maps the existing service outcomes to the unchanged HTTP
  contract.
- The legacy handler was removed from `dreamController.ts`; the route path,
  middleware order, and exported handler name remain unchanged.

### Verification

- Backend TypeScript: passed.
- Route contract: 98 feature routes + 1 health route preserved.
- Existing contract suites: 26/26 passed.
- The shared frontend delete action now emits one localized success toast after
  the server confirms deletion, covering both feed-card and detail-modal entry
  points without duplicate notifications.
- CALM pre-edit blast-radius check completed; its post-edit Git diff scan cannot
  resolve the nested backend repository from the parent workspace index.

## R8 — Dream privacy

### Scope and locked behavior

- `PATCH /api/dreams/:id/privacy` remains authenticated and owner-scoped.
- Invalid IDs still return 400 with `Invalid dreamId.`.
- Only the exact values `public` and `private` are accepted; invalid input keeps
  the existing 400 message.
- A missing dream or non-owner request still returns 403.
- `privacy` and the legacy `is_public` flag are updated atomically in the same
  MongoDB operation.
- Success remains 200 with `Privacy updated.` and the existing mapped Dream
  response; unexpected failures keep the former 500 contract.
- This phase does not change feed filtering, author visibility, symbol
  observation indexing, or any other product policy.

### Structure

```text
PATCH /api/dreams/:id/privacy
  -> dreamPrivacy.dto.ts
  -> dreamPrivacy.controller.ts
  -> dreamPrivacy.service.ts
  -> mapDreamResponse
```

- The DTO validates route identity and the two-value privacy union.
- The service owns the owner-scoped atomic update.
- The controller only maps validation, not-found and success outcomes to HTTP.
- The mixed `dreamController.ts` no longer owns the privacy handler; route path,
  middleware order and handler name are preserved.

### Verification

- Backend TypeScript: passed.
- Frontend production build: passed.
- Route contract: 98 feature routes + 1 health route preserved.
- Existing contract suites: 26/26 passed.
- Privacy changes now emit one localized success toast from the shared store
  action, regardless of whether the change starts in the card or detail modal.
- The detail modal renders the same private-state badge as the feed card and
  updates immediately from the returned Dream response.
- EN/VI parity: 14/14 passed with 1,274 keys per locale.

## R9 — Dream like engagement

### Scope and locked behavior

- `POST /api/dreams/:id/like` keeps its existing 400/403/404/500 messages and
  200 response fields.
- Private dreams remain likeable only by their owner.
- Like and unlike still update the Dream once before best-effort notification
  and rank-point work.
- A new like still creates one notification, emits one socket event, and adds
  ten rank points to the post owner. Unlike does not create a notification.
- Notification/rank failures remain non-fatal to the like response.

### Structure

```text
POST /api/dreams/:id/like
  -> dreamLike.dto.ts
  -> dreamLike.controller.ts
  -> engagement/dreamLike.service.ts
```

- The controller maps HTTP and emits the prepared notification.
- The service owns the Dream mutation, notification creation and rank update.
- The DTO owns only route-ID validation.
- No multi-line generated documentation was added; new functions use short
  human-readable comments only.

### Mood tag policy

- `DreamMoodTag.vue` is now the single tag renderer for cards and modals.
- The model receives `emotional_valence` in the closed range `-2..2`, while
  `emotional_tone` remains a short, dream-specific label.
- Colors are ordered from deep red (`-2`) through orange, yellow, light green
  to green (`2`). The separate `?` button was removed; the complete tag now
  uses a help cursor and opens one shared five-level legend on click or
  keyboard activation. The legend lists the positive end first and the red
  end last, so the scale becomes better as the user reads upward.
- Older results without the new field are mapped from their existing tone key;
  generic “Unclear” labels display a meaningful scale label instead.
- The old modal-only keyword classifier was removed, so card and modal cannot
  disagree because of separate regex rules.

### Verification

- Backend TypeScript: passed.
- Frontend production build: passed.
- Route contract: 98 feature routes + 1 health route preserved.
- Existing contract suites: 26/26 passed.
- EN/VI parity: 14/14 passed with 1,284 keys per locale.
- Refactored Dream DTO/service files use short comments; the remaining large
  controller comments will be reduced as each remaining capability is moved.

### R9 follow-up — notification opening and mood legend

- Feed notifications no longer navigate through `openPostId` for ordinary
  dream posts. The shared post store opens the detail modal directly, so the
  current feed scroll position is preserved. Oracle-analysis notifications
  continue to open the Oracle result dialog directly.
- The mood legend is implemented once in `DreamMoodTag.vue` and reused by the
  feed card and detail modal. It is localized in both Vietnamese and English,
  keyboard-readable through `aria-expanded`, and closes when clicking outside.

## R10 — Dream analysis naming and remaining boundary audit

### Before

- `controllers/dreamAnalysisDispatch.ts` exposed a controller-layer queue
  bridge without the `.controller.ts` suffix.
- The main `dreamController.ts` still contains the legacy analysis endpoints,
  comment endpoints, debug retrieval endpoint and hypothesis feedback endpoint.
- Analysis contracts were under `services/analysis/contracts`, but this was
  not documented, making the `.contract.ts` suffix look inconsistent.

### After

- Renamed the queue bridge to
  `controllers/dreamAnalysisDispatch.controller.ts` and updated both callers.
- Kept `services/analysis/contracts/dreamAnalysis.contract.ts` in place:
  it defines shared input/output types and does not execute business logic, so
  `.contract.ts` is intentional.
- The remaining `dreamController.ts` handlers are deliberately not moved in
  this pass because their analysis execution helper and rollback state are
  shared by the fair queue. The next extraction must move the full analysis
  capability together, not split individual functions and risk changing
  cancellation/recovery behavior.

### Verification

- Backend TypeScript: passed.
- Frontend production build: passed.
- Route contracts and public behavior remain unchanged.

## R11 — Dream analysis runtime registry

### Before

- The controller owned the in-memory map of active provider requests.
- Background execution and cancel reached directly into the same map.
- The controller also retained an unused derived `analysisKey` after the
  registry operations were extracted.

### After

```text
dreamController.ts
  -> dreamAnalysisRuntime.service.ts
       -> registerDreamAnalysisController
       -> abortDreamAnalysisExecution
       -> clearDreamAnalysisController
```

- Runtime ownership now lives in one execution service.
- Cancel aborts the provider through the same boundary used by the background
  runner.
- Cleanup still checks controller identity before deleting a registry entry, so
  a late run cannot clear a newer run with the same Dream ID.
- Removed the unused local `analysisKey`; persisted rollback and commit-fence
  behavior remain unchanged.
- New functions use one short comment describing intent.

### Verification

- Backend TypeScript: passed.
- Route contract: 98 feature routes + 1 health route preserved.
- Existing contract suites: 26/26 passed.

## R12 — Dream symbol-observation synchronization boundary

### Before

- `dreamController.ts` implemented the secondary symbol-index refresh itself.
- Direct analysis, background completion and hypothesis feedback all depended
  on this controller-local helper.
- This dependency prevented the background runner from moving cleanly into the
  execution service layer.

### After

```text
analysis completion / feedback
  -> dreamSymbolObservationSync.service.ts
       -> symbolObservation.service.ts
```

- The shared synchronization policy now lives in the analysis execution layer.
- A secondary-index failure remains non-fatal and is logged with the Dream ID.
- All three existing callers keep the same behavior.
- The service uses one short intent comment before its exported function.

### Verification

- Backend TypeScript: passed.
- No route or response contract changed.

## R13 — Dream analysis rollback and runner extraction

### Before

- `dreamController.ts` contained rollback persistence and the full background
  runner.
- `server.ts` and dispatch code depended on the controller for execution.

### After

```text
analysis/execution/
├── dreamAnalysisRollback.service.ts
└── dreamAnalysisRunner.service.ts
```

- Rollback is now a 96-line execution service.
- Background analysis is now a 166-line execution service.
- `server.ts` imports the runner and recovery from execution services.
- Dispatch imports the runner from the same execution boundary.
- `dreamController.ts` dropped from 993 to 742 lines.
- Commit-fence, progress updates, notifications, rollback and abort cleanup
  were moved without changing their logic.

### Verification

- Backend TypeScript: passed.
- Route contract: 98 feature routes + 1 health route preserved.

## R14 — Dream HTTP boundary completion and task restoration

### Before

- `dreamController.ts` still mixed create, comments, direct analysis, RAG
  diagnostics, retry, cancellation and hypothesis feedback.
- A cancelled run could retain 99% progress in the frontend task object when
  retried.
- Persisted pinned tasks did not retain their creation order. Parallel restore
  requests could therefore reorder the pins after a reload.

### After

```text
controllers/
├── dreamCreate.controller.ts
├── dreamComment.controller.ts
├── dreamAnalyze.controller.ts
├── dreamAnalysis.controller.ts
├── dreamDebug.controller.ts
└── dreamFeedback.controller.ts

analysis/execution/
└── dreamAnalysisRetry.service.ts
```

- Removed `dreamController.ts`; all 12 Dream controllers now have one HTTP
  responsibility.
- Retry preparation and queue submission live in an 80-line execution service.
- Retry progress now accepts the persisted run progress instead of retaining a
  stale percentage from the cancelled run.
- Pinned task persistence now stores `createdAt`; parallel network restoration
  is completed before tasks are recreated in their original order.
- Notification ordering uses one deterministic MongoDB sort with `_id` as the
  tie breaker.

### Verification

- Backend TypeScript: passed.
- Frontend production build: passed.
- Route contract: 98 feature routes + 1 health route preserved.
- Dream routes: 16/16 unchanged.
- Backend contract suites: 26/26 passed.
- EN–VI parity and side-effect suites: 14/14 passed.
