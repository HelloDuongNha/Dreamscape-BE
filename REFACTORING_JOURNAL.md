# DreamScape Backend Refactoring Journal

This journal is the source of truth for the behavior-preserving refactor. Each
phase records its scope, locked contracts, unresolved policy questions,
verification results, and the UI checks required before the next phase starts.

## Global safety rules

- Refactor one complete user-facing capability at a time.
- Write each coordinator as a top-down pipeline whose calls expose the complete
  business flow without requiring the reader to inspect implementation details.
- Route each meaningful conditional branch through a named handler instead of
  placing multiple workflows inside one `if/else` block.
- Keep one-use helpers below their coordinator; move a helper only when it owns
  a distinct capability or is genuinely reused.
- Handle invalid input, missing state, cancellation and terminal conditions
  with early returns before the main success path.
- Prefer explicit business types and names over `any`, nested type tricks or
  abstractions created only to reduce line count.
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

## R15 — Dream reasoning boundary completion

### Before

- `dreamAnalysisGrounding.service.ts` was a 977-line facade containing
  contextual motifs, text grounding, feedback revision, case assessment and
  scientific-note handling.
- `analyze.service.ts` was a 931-line function containing profile loading,
  retrieval, rule/evidence preparation, prompt compaction, model generation,
  output validation and audit construction.

### After

```text
analysis/grounding/
├── contextualMotif.service.ts
├── dreamCaseAssessment.service.ts
├── dreamFeedbackRevision.service.ts
├── dreamGroundingText.service.ts
├── dreamAnalysisGrounding.service.ts
└── scientificNote.service.ts

analysis/orchestration/
├── analyze.service.ts
├── dreamAnalysisNormalization.service.ts
├── dreamAnalysisOrchestration.types.ts
├── dreamAnalysisOutput.service.ts
├── dreamAnalysisProfile.service.ts
├── dreamAnalysisPromptContext.service.ts
├── dreamContextRetrieval.service.ts
└── dreamRuleEvidence.service.ts
```

- The public grounding facade remains available for compatibility.
- `runDreamAnalysis` remains the public orchestration facade at 262 lines.
- Retrieval, evidence mapping, profile preparation and deterministic output
  validation are now independently readable and each service stays below the
  300-line target.
- Prompts remain in the existing prompt module; no prompt wording or model
  call behavior was changed.

### Verification

- Backend TypeScript: passed.
- Route contract: 98 feature routes + 1 health route preserved.
- Backend contract suites: 26/26 passed.
- EN–VI parity and side-effect suites: 14/14 passed.

## R16 — Dream ETA calibration and result presentation

### Before

- ETA history used `durationMs`, which included queue waiting time for older
  runs and could make a copied dream appear to finish far earlier than its
  estimate.
- The initial result view displayed the preliminary case-boundary card before
  the actual summary and analysis, making internal uncertainty the first thing
  users saw.

### After

- The runner records `processingStartedAt` and `processingDurationMs`.
- Future ETA samples use only processing-only durations; legacy queue-inclusive
  durations are ignored.
- The baseline is `45 + 0.06 × normalized narrative characters` seconds, then
  blended with the median processing rate from valid recent runs:
  `0.30 × baseline + 0.70 × (45 + medianSecondsPerCharacter × characters)`.
- Queue time remains visible through the queued stage but is not treated as
  model-processing time.
- Preliminary case-boundary details are no longer displayed before the main
  summary. They remain available after the case has been clarified by feedback.
- If a valid contextual rule exists but the model omitted a usable question,
  the output pipeline creates one grounded question from the reported waking
  reaction and exact dream evidence.

## R17 — Remove redundant case-conclusion presentation

- The post-analysis screen no longer renders the `case_conclusion` card.
- Feedback data is still persisted and used to revise the analysis, but the UI
  now goes directly from the Oracle header to the summary, core analysis,
  questions and evidence.
- Removed the unused case-conclusion, concern-card, evidence-chain and
  narrative-summary styles from `OracleAnalysisResult.vue`.

## R18 — Dream module closure

### R18.1 — Case conclusion boundary

- Moved case-conclusion construction into
  `analysis/grounding/dreamCaseConclusion.service.ts`; case-answer feedback
  remains in `dreamCaseAssessment.service.ts`.
- Kept the grounding response facade stable so existing imports and response
  behavior remain unchanged.

### R18.2 — Analysis response boundary

- Moved response assembly out of the grounding facade into
  `dreamAnalysisResponse.service.ts`.
- Moved question, source and rule-score linking into
  `dreamResponseQuestion.service.ts`.
- `dreamAnalysisGrounding.service.ts` is now a seven-line compatibility facade.

### R18.3 — Feedback execution boundary

- Reduced `dreamFeedback.controller.ts` from 225 to 94 lines.
- Moved feedback persistence, analysis revision, rule scoring and symbol
  synchronization into `analysis/execution/dreamFeedback.service.ts`.
- Validation failures retain their existing HTTP 400 responses; unexpected
  execution failures remain HTTP 500.

### R18.4 — Contracts and continuation recovery

- Updated the route contract baseline to the current 17 Dream routes and 99
  total feature routes, including the existing AI-analysis policy endpoint.
- Updated the grounding regression expectation to reflect the intended product
  behavior: a confirmed answer revises the relevant interpretive thread instead
  of silently leaving the analysis unchanged.
- Initial and regenerated continuations now share the same narrative anchors
  and earned-awakening contract.
- Regeneration repairs provider output that omits internal audit fields before
  falling back, so a schema-only miss no longer produces a user-visible 500.
- Regeneration success and failure messages use the active frontend locale.

### Locked behavior

- Dream route paths, middleware order, response shapes, queue lifecycle,
  cancellation, rollback, notification behavior and AI-analysis policy remain
  unchanged.
- No dream-specific keyword fixture or prompt behavior was added in this
  closure pass.
- The continuation prompt remains separate from scientific analysis and the
  reload path still branches from the original dream context.

### Verification

- Backend TypeScript: passed.
- Route contract: 99 feature routes + 1 health route preserved.
- Contract suite: 26/26 files passed.
- Frontend production build: passed.
- Git whitespace/error check: passed.
- All Dream controllers are below 150 lines and all Dream services are below
  300 lines.
- UI acceptance: project-owner verification remains the final product check.

## A1 — Approved academic source read boundary

### Scope

- `GET /api/sources/approved`
- `GET /api/sources/approved/:id`
- `GET /api/sources/approved/:id/read`
- `POST /api/sources/approved/:id/read/translate`
- `GET /api/sources/approved/:id/original-document`
- `GET /api/sources/approved/:id/pdf-inline`

### Before

- Six read endpoints shared the 1,746-line `sourceController.ts` with source
  contribution, PDF mutation and import-job behavior.
- Catalog pagination, ObjectId checks and reader pagination were parsed inline.
- The Academic DTO folder contained only a placeholder.

### After

```text
controllers/
├── approvedSource.controller.ts
├── approvedSourceReader.controller.ts
├── approvedSourceDocument.controller.ts
└── approvedSourceTranslation.controller.ts

dto/
└── approvedSource.dto.ts

services/
├── reader/approvedSourceReader.service.ts
├── source/academicSourceResponse.service.ts
├── source/approvedSourceCatalog.service.ts
└── storage/approvedSourceDocument.service.ts
```

- Controllers now handle only HTTP status, headers and response envelopes.
- DTO parsing preserves the existing page defaults and limits.
- Catalog queries, canonical reader assembly and document resolution now have
  separate service boundaries.
- The shared source response mapper remains available to the contribution and
  PDF mutation handlers without duplicating normalization rules.
- Direct controller imports in the reader contract tests now point to the new
  capability-owned controllers; no compatibility wrapper was left behind.
- Removed unused Crossref, Unpaywall and URL helpers that had no callers.
- `sourceController.ts` is reduced to the contribution and PDF mutation
  capabilities scheduled for later Academic phases.

### Locked behavior

- Route paths, middleware order, status codes, response fields, pagination
  defaults, canonical hashes, translation cancellation and SSRF handling remain
  unchanged.
- No Docling, OCR, Smart Reader import, translation-provider or persistence
  policy was changed.

### UI acceptance checklist

- Search and paginate the approved-source catalog.
- Open an approved source and its Smart Reader pages.
- Open an uploaded PDF and an external open-access PDF inline.
- Switch Reader translation between Vietnamese and English.
- Refresh an open source and confirm the same page and source metadata return.

### Verification

- Backend TypeScript: passed.
- Canonical Reader Identity: 213 assertions passed.
- Canonical Reader Translation: 131 assertions passed.

## A2 — Academic contribution moderation boundary

### Scope

- Preview and submit an academic source contribution.
- List pending, approved or rejected contributions.
- Update a pending contribution title.
- Approve or reject a contribution.
- Promote preview reader data and start the existing full-text import after approval.

### Before

- Contribution submission still shared the remaining 938-line
  `sourceController.ts` with PDF and import-job behavior.
- Moderation listing, title editing, approval, rejection, storage cleanup and
  reader promotion shared the 2,531-line `moderationController.ts`.
- Request parsing and validation were performed inline in those controllers.

### After

```text
controllers/
├── sourceContribution.controller.ts
├── sourceModeration.controller.ts
└── sourceReview.controller.ts

dto/
└── sourceContribution.dto.ts

services/contribution/
├── contributionSubmission.service.ts
├── contributionModerationQueue.service.ts
├── contributionReview.service.ts
├── contributionApproval.service.ts
├── contributionApprovalFinalization.service.ts
├── contributionRejection.service.ts
└── contributionReaderStats.service.ts
```

- Controllers now translate HTTP requests and service results only.
- The DTO owns pagination, title, review-state and note validation.
- Submission, moderation queries, approval finalization, rejection rollback and
  reader statistics have separate service boundaries.
- Duplicate checks retain their original order, so a source already in the
  approved library still takes precedence over a pending contribution.
- `sourceController.ts` is now 615 lines; `moderationController.ts` is now
  1,810 lines. Their remaining capabilities belong to later Academic phases.

### Locked behavior

- Route paths, middleware order, status codes, response envelopes and user-facing
  messages remain unchanged.
- Duplicate detection, rejected-contribution reactivation, contribution counters,
  approval promotion, automatic full-text import and Rule V3 cleanup retain their
  existing order.
- Rejection still restores the database state if Cloudinary deletion fails.
- No Docling, OCR, Smart Reader parsing or Rule V3 extraction policy was changed.

### UI acceptance checklist

- Preview a DOI or URL and submit it for moderation.
- Submit an existing approved source and confirm the duplicate warning.
- Edit the title of a pending PDF contribution.
- Switch among pending, approved and rejected moderation lists.
- Approve a source and confirm its Smart Reader/import status still updates.
- Reject an uploaded PDF and confirm it leaves the pending list.

### Verification

- Backend TypeScript: passed.
- No A2-owned unused TypeScript symbol remains.
- Route contract: 99 feature routes + 1 health route preserved.
- Full regression baseline: 26/26 contract files passed.
- Git whitespace/error check: passed.
- Post-edit impact scan: low aggregate call-graph risk.

## A3 — Academic PDF storage and import boundary

### Scope

- Submit a PDF as a pending academic contribution.
- Cache, upload, replace or delete an approved source's original PDF.
- Start, inspect or cancel the approved-source PDF import workflow.
- Remove obsolete Cloudinary wording from original-PDF UI labels.

### Before

- The remaining 615-line `sourceController.ts` mixed contribution submission,
  original-file mutation and long-running import-job endpoints.
- Original PDFs had already moved to Firebase Storage, but the UI still claimed
  they were stored on Cloudinary.
- PDF contribution metadata parsing and request validation remained inline in
  the controller.

### After

```text
controllers/
├── pdfContribution.controller.ts
├── originalPdfMutation.controller.ts
└── pdfImport.controller.ts

dto/
└── pdfSource.dto.ts

services/
├── contribution/pdfContribution.service.ts
├── contribution/pdfContributionMetadata.service.ts
└── storage/originalPdfMutation.service.ts
```

- `sourceController.ts` was removed; no compatibility wrapper remains.
- Routes are grouped by capability rather than artificial CRUD names:
  contribution, original-PDF mutation and import-job control.
- Controllers are 29–79 lines; new services are 59–250 lines.
- PDF validation, duplicate handling, rejected-item reactivation, replacement
  cleanup and import-job options now have explicit boundaries.
- User-facing labels say DreamScape storage; Cloudinary support remains only for
  legacy original files and extracted reader images.

### Locked behavior

- Route paths, middleware order, response envelopes and duplicate precedence
  remain unchanged.
- A failed database save still removes the newly uploaded Firebase object.
- A replacement deletes the previous object only after the new reference saves.
- A rejected contribution can still be reactivated without losing rollback.
- PDF import progress, cancellation and execution still call the same workflow
  services used before this refactor.

### UI acceptance checklist

- Upload a PDF contribution and confirm it appears in the pending list.
- Try a duplicate DOI or duplicate PDF and confirm the existing-source warning.
- Upload or replace an approved source's original PDF.
- Delete an original PDF while keeping its Smart Reader intact.
- Start, hide, reopen and cancel a PDF Smart Reader import.
- Switch Vietnamese/English and confirm no original-PDF action mentions Cloudinary.

### Verification

- Backend TypeScript and production build: passed.
- Frontend TypeScript and production build: passed.
- Route contract: 99 feature routes + 1 health route preserved.
- Full regression baseline: 26/26 contract files passed.
- Post-edit backend and frontend impact scans: low aggregate risk.

## A4 — Academic moderation and reader operations

### Scope

- Upload, stream, cache and remove a pending contribution's original PDF.
- Build RAG chunks for a moderated source.
- Delete a contribution or approved source with its derived data.
- Import or replace a Smart Reader while preserving rollback behavior.
- Load and translate the moderator's Smart Reader preview.

### Before

- `moderationController.ts` contained 1,810 lines and ten unrelated endpoint
  families.
- It retained dead PDF parsers, URL fetch helpers, storage imports and duplicate
  comments after earlier functionality had moved elsewhere.
- Reimport preflight treated only legacy Cloudinary files as stored PDFs, despite
  current uploads using Firebase.
- Approved and contribution import-job controllers repeated the same progress,
  cancellation and execution code.

### After

```text
controllers/
├── contributionPdf.controller.ts
├── moderationPdfUpload.controller.ts
├── ragChunkBuild.controller.ts
├── readerImport.controller.ts
├── sourceDeletion.controller.ts
├── sourcePreview.controller.ts
└── sourcePreviewTranslation.controller.ts

services/
├── reader/ragChunkBuild.service.ts
├── reader/ragChunkPlanning.service.ts
├── reader/readerReimport.service.ts
├── reader/sourcePreview.service.ts
├── source/sourceDeletion.service.ts
├── storage/contributionPdfDocument.service.ts
├── storage/contributionPdfMutation.service.ts
└── storage/moderationPdfUpload.service.ts
```

- `moderationController.ts` was removed; no compatibility wrapper remains.
- Controllers are 26–105 lines. New services are 43–221 lines.
- PDF import progress, cancel and process endpoints now share one internal
  controller flow for both approved sources and pending contributions.
- Reimport accepts the shared original-file abstraction, covering Firebase and
  legacy Cloudinary assets without provider-specific eligibility logic.
- Preview composition, translation transport, storage mutation, deletion and RAG
  planning now have separate, named boundaries.

### Locked behavior

- Route paths, middleware order, response envelopes and public error codes remain
  unchanged.
- Reader replacement still stages new data, restores the previous reader on
  failure or cancellation, and removes old derived Rule V3 data only after a
  successful import.
- Source deletion retains transaction fallback and only removes stored files
  after database cleanup succeeds.
- Canonical reader identity, block hashes and translation cancellation remain
  byte-compatible with their existing contracts.
- The response key `cloudinaryAssets` remains temporarily for API compatibility;
  it now counts deleted stored original files regardless of provider.

### Follow-up observations

- `smartReaderImport.service.ts` (1,675 lines) is the next high-risk Academic
  boundary: orchestration, parser selection, OCR cleanup and persistence remain
  mixed.
- `sourceImportResolver.service.ts`, `doclingReaderPolicy.service.ts`,
  `originalPdfAsset.service.ts` and `htmlArticleParser.ts` still exceed the
  service-size target and need capability-based extraction.
- Several ingestion policies attach temporary flags through `as any`; these
  should become an explicit intermediate type instead of accumulating hidden
  object properties.
- Legacy Cloudinary branches remain necessary for existing stored documents and
  must not be deleted until migration data confirms they are unused.

### UI acceptance checklist

- Upload a PDF contribution, open its inline preview, cache it and delete it.
- Start a pending contribution's Smart Reader import, reopen progress and cancel
  it; confirm the previous reader remains available.
- Reimport an approved Firebase-backed PDF and confirm the new reader replaces
  the old one only after completion.
- Open a pending source preview and switch reader pages/sections.
- Translate selected preview blocks, then close the modal during translation to
  confirm cancellation remains responsive.
- Build RAG chunks and confirm the final chunk counts/status appear unchanged.
- Delete both a pending contribution and an approved source.

### Verification

- Backend TypeScript: passed.
- Route contract: 99 feature routes + 1 health route preserved.
- Full regression baseline: 26/26 contract files passed.
- Canonical Smart Reader identity: 213 assertions passed.
- Git whitespace/error check: passed.

## A5.1 — Reader source integrity and build provenance

### Problem found

- The “DOI / HTML / XML” action called a generic reimport pipeline that also
  accepted an uploaded PDF.
- When a structured source was blocked, the importer could silently select the
  PDF parser, replace the current reader and still report the structured action
  as successful.
- The UI classified every PDF-like snapshot as “PDF · Docling”, even when the
  actual engine was the older PDF parser.
- Build duration lived only in a separate PDF timing history. The UI guessed
  snapshot/timing pairs by nearby timestamps, so a build could show no duration
  or inherit the wrong timing record.

### Change

- Added an explicit `structured_only` source policy to the shared import
  contract.
- DOI / HTML / XML endpoints now reject PDF candidates. A blocked or unavailable
  structured source rolls back the replacement and keeps the existing reader.
- The PDF pipeline may still try a structured source first, but only that
  explicitly selected PDF workflow may continue to Docling fallback.
- Reader snapshots now own their duration and optional estimate/page/OCR
  provenance.
- Snapshot persistence moved to
  `reader/history/readerBuildHistory.service.ts`.
- The history UI uses the real parser engine. Legacy PDF-parser builds are no
  longer relabeled as Docling.
- Repeated completion time, duration and reader-size fields were removed from
  the expanded history content; the summary remains the single compact source
  for those values.

### Locked behavior

- Existing readers remain protected by the replacement transaction and rollback
  workflow.
- Selecting “Rebuild from PDF (Docling)” still permits an intentional PDF
  replacement.
- Historical snapshots without recorded duration remain unchanged; duration is
  never fabricated. Existing PDF timing samples are still used as a backward
  compatibility fallback where an unambiguous match exists.
- Reader chunk, section, canonical identity and Rule V3 contracts are unchanged.

### UI acceptance checklist

- On a PDF-backed source whose DOI host blocks access, choose “Re-import from
  DOI / HTML / XML”. Confirm failure is reported and the existing PDF reader and
  chunk count do not change.
- Choose “Rebuild from PDF (Docling)” on the same source. Confirm it runs the PDF
  workflow and the new history row says `PDF · Docling`.
- Open reader-build history and confirm a new build has one completion time, one
  size summary and a recorded duration.
- Expand the row and confirm engine/source type are shown without repeating the
  summary.
- Switch English/Vietnamese and confirm the new history labels translate.

### Verification

- Backend TypeScript: passed.
- Frontend production build: passed.
- Route contract: 99 feature routes + 1 health route preserved.
- Full regression baseline: 26/26 contract files passed.
- Git whitespace/error checks: passed in both repositories.

## A5.2 — Reader run history and source-selection boundary

### Change

- Reader build snapshots now record `success` or `failed`; failed attempts keep
  their parser, source type, duration, failure code and safe failure message.
- Failed PDF runs remain excluded from `pdfImportHistory`, because that history
  is used only as successful processing-speed input for later estimates.
- Reader and Argument history summaries now show only the run number, result
  and duration. Dates moved into the expanded details.
- Argument failures already persisted their sanitized error codes; the UI now
  presents that existing reason in the same compact history structure.
- Candidate grouping, structured-only policy enforcement, block
  classification and deterministic source selection moved from the large
  importer into `readerSourceSelection.service.ts`.
- `smartReaderImport.service.ts` remains the orchestration entry point and
  keeps its public `classifyBlock` export for compatibility.

### Locked behavior

- Existing successful history rows without `status` are treated as successful.
- A failed attempt never replaces the current reader and never influences the
  PDF duration estimator.
- Source preference remains XML, clean publisher HTML, low-noise PDF, then the
  same first-available fallback used before this extraction.

### UI acceptance checklist

- Open Reader builds and confirm the compact row no longer contains a date.
- Expand a successful Reader build and confirm its completion time is shown.
- Trigger a known blocked DOI / HTML / XML import and confirm a failed Reader
  row appears with its reason while the previous reader remains unchanged.
- Open Argument analysis runs and confirm compact rows omit the date; expand a
  failed run and confirm its start time and stop reason are shown.

## A5.3 — Structured candidate execution boundary

### Change

- Candidate download, temporary-file lifecycle, parser invocation,
  normalization and quality diagnostics moved to
  `readerCandidateExecution.service.ts`.
- The executor keeps one ordered attempt log and reports whether any candidate
  was blocked with HTTP 403.
- `smartReaderImport.service.ts` now coordinates candidate collection,
  execution, selection and persistence instead of implementing candidate I/O
  inline.
- Removed the unused synchronous Tesseract availability probe. Its result was
  assigned but never read and had no effect on OCR or reader output.

### Locked behavior

- Candidate groups still run in the same order: PDF, XML, publisher HTML, then
  generic HTML only when XML and publisher HTML both fail.
- Uploaded PDFs still use the original-file storage adapter; network candidates
  still use the SSRF-safe redirect fetcher.
- Every temporary parser file is deleted in `finally`, including failed parser
  attempts.
- Parsing, normalization, quality scoring and candidate diagnostics use the
  same services and fields as before.

### UI acceptance checklist

- Rebuild one uploaded PDF and confirm the resulting Reader content and history
  engine remain Docling/PDF as expected.
- Reimport one accessible DOI/XML source and confirm its structured reader is
  selected.
- Reimport one blocked source and confirm candidate failure details are
  preserved and the old reader remains available.

## A5.4 — Reader presentation, tables and figure ownership

### Change

- Reader HTML escaping and allow-list sanitization moved to
  `readerHtml.service.ts`.
- Linked Nature/Springer table retrieval, duplicate-table reconciliation and
  final table markup moved to `readerTableProcessing.service.ts`.
- Structured figure ownership conversion moved to
  `readerFigureOwnership.service.ts`; the importer now passes blocks and the
  transaction asset list instead of implementing uploads inline.
- `smartReaderImport.service.ts` remains responsible for ordering these
  capabilities and transactional reader persistence.

### Locked behavior

- Table links are fetched only for publisher/generic HTML sources and only when
  structured table content is missing.
- Duplicate tables retain the longer caption and prefer the latest available
  table markup exactly as before.
- Existing owned PMC figures are not uploaded again.
- A successful figure upload preserves the existing caption/legend. Failed
  uploads remove the external URL and retain the same caption-only fallback.
- All generated table and figure markup passes through the same HTML allow-list.

### UI acceptance checklist

- Open a structured article with tables and confirm captions, table cells and
  duplicate-table handling are unchanged.
- Open a source with figures and confirm owned images still render.
- Trigger a missing figure image and confirm the caption-only placeholder is
  shown without persisting the publisher URL.

## A5.5 — Figure reconciliation and image asset lifecycle

### Change

- Figure URL verification, retry classification, duplicate reconciliation and
  final caption markup moved to `readerFigureReconciliation.service.ts`.
- DOI-to-PMCID lookup, PMC page image mapping and Europe PMC archive recovery
  moved to `readerPmcContext.service.ts`.
- Persisted, used and obsolete reader-image asset tracking moved to
  `readerImageAssetLifecycle.service.ts`.
- `smartReaderImport.service.ts` is now 700 lines, down from 1,071 at the start
  of this slice and 1,687 before the structured-import refactor.

### Locked behavior

- Image URLs still pass through the SSRF-safe fetcher and the same binary/SVG
  checks before appearing in reader HTML.
- Terminal image failures remain cached; transient failures retain the same
  three-attempt limit and fallback to the original URL after a PMC mapping
  fails.
- Duplicate numbered figures still keep the longer caption and prefer the
  current verified image over the earlier verified image.
- Owned PMC archive images remain transaction-aware: failed imports delete new
  uploads, successful replacements retain used assets and retire unused ones.
- A PMCID collision is still used only as a transient import hint and is not
  persisted onto the wrong source.

### Verification

- TypeScript compilation: passed.
- Route contract: 99 feature routes plus the health route preserved.
- Contract baseline: 26/26 suites passed.

- CALM post-edit scan completed; the reported importer signature risk is from
  the accumulated extraction diff, while its external call shape and verified
  caller remain unchanged.

### UI acceptance checklist

- Reimport one PMC article containing duplicate numbered figures and confirm
  each figure appears once with its caption.
- Open a PMC reader after reimport and confirm image assets render instead of
  external-link placeholders.
- Cancel or fail a reimport after image preparation and confirm the previous
  reader remains intact.
- Reimport the same PMC source again and confirm no duplicate image rows or
  missing previously retained figures appear.

## A5.6 — Reader block cleanup pipeline

### Change

- Embedded-heading repair, endmatter removal, reference cleanup, orphan-heading
  removal and consecutive-paragraph deduplication moved to
  `readerBlockCleanup.service.ts`.
- Figure/table number extraction now has one shared helper instead of a local
  closure inside the import coordinator.
- `smartReaderImport.service.ts` is now 457 lines; the cleanup service is 226
  lines and contains only deterministic block transformations.

### Locked behavior

- Cleanup runs in the same order around table and figure reconciliation.
- Endmatter mode begins and ends on the same headings and retains the same
  short-metadata paragraph threshold.
- Reference cleanup keeps the first reference heading, discards orphan
  reference blocks, and applies the same junk, first-citation and duplicate
  checks.
- Orphan headings retain the original protected-heading list and three cleanup
  passes.
- Consecutive paragraph comparison keeps the same case and whitespace
  normalization.

### Verification

- TypeScript compilation and diff whitespace checks passed.
- Route contract: 99 feature routes plus the health route preserved.
- Contract baseline: 26/26 suites passed.

- CALM post-edit scan completed; importer callers remain unchanged.

### UI acceptance checklist

- Reimport an article with References and confirm one heading and the expected
  citation list remain.
- Reimport an article containing acknowledgements/funding and confirm those
  endmatter sections do not appear in Smart Reader.
- Open an article whose heading is embedded at the start of a paragraph and
  confirm the heading and following paragraph render separately.
- Confirm repeated adjacent paragraphs do not appear twice.

## A5.7 — Reader reconciliation coordinator

### Change

- Source selection, article-block filtering, PDF/structured media enrichment,
  boilerplate exclusion, reference restoration and final validity checks moved
  to `readerReconciliation.service.ts`.
- `smartReaderImport.service.ts` now coordinates candidate execution,
  reconciliation, transactional persistence and the final response only.
- The importer is 254 lines and reconciliation is 296 lines, both within the
  service-size limits used for this refactor.

### Locked behavior

- Source priority and PDF artifact scoring remain delegated to the existing
  selection service.
- PDF remains the main body only when selected by the same policy; XML/HTML
  still enrich numbered figures, tables and references.
- Structured HTML still uses PDF headings to exclude publisher widgets when a
  PDF is available.
- Challenge pages, metadata-only readers and PDFs above the 30% artifact
  threshold are rejected using the same conditions.
- Import result messages, candidate attempts, resolver diagnostics and
  transaction rollback behavior are unchanged.

### Verification

- TypeScript compilation and diff whitespace checks passed.
- Route contract: 99 feature routes plus the health route preserved.
- Contract baseline: 26/26 suites passed.
- CALM post-edit scan completed; the external importer call shape and its
  verified caller remain unchanged.

### UI acceptance checklist

- Reimport one clean DOI/XML article and confirm the structured reader is still
  selected with the same sections.
- Reimport one PDF whose XML/HTML contains figures or tables and confirm the PDF
  body is enriched without duplicate media.
- Retry a blocked or metadata-only source and confirm failure is reported while
  the previous reader remains available.
- Reimport an uploaded PDF and confirm Reader builds still records PDF/Docling,
  section count, chunk count and duration.

## A6.1 — Source import resolution

### Change

- `sourceImportResolver.service.ts` is now a 44-line priority dispatcher,
  reduced from 680 lines.
- Resolver request/response contracts moved to
  `dto/sourceImport.dto.ts`, replacing the previously missing DTO boundary for
  this workflow.
- Crossref, Europe PMC, Google Books and Open Library calls moved to
  `sourceMetadataProviders.service.ts`.
- DOI/PMCID/ISBN policy, uploaded-PDF verification and web-URL crawling moved
  to separate capability services.
- Removed DOI locals that were assigned but never read and had no effect on the
  returned source metadata.

### Locked behavior

- Input priority remains PMCID, DOI, uploaded PDF, ISBN, then URL.
- Crossref and Europe PMC retain their nine-second timeout and existing
  warning/fallback behavior.
- Frontiers DOI URLs, Unpaywall Open Access selection and closed-access
  warnings are unchanged.
- Uploaded assets still require the same moderator identity, folder prefix and
  raw-resource verification.
- Web URLs retain SSRF checks, direct-PDF handling, safe redirects and the same
  metadata-tag priority.

### Verification

- TypeScript compilation and diff whitespace checks passed.
- Route contract: 99 feature routes plus the health route preserved.
- Contract baseline: 26/26 suites passed.
- CALM caller review confirmed all five production callers still use the same
  two-argument function contract.

### UI acceptance checklist

- Preview one DOI and confirm title, authors, journal and Open Access status.
- Preview one PMCID and confirm Europe PMC XML/HTML/PDF links remain available.
- Preview one ISBN and confirm it remains metadata-only.
- Preview a normal web URL, an unsafe URL and a direct PDF URL; confirm their
  three distinct results remain unchanged.
- Upload one PDF contribution and confirm asset verification and metadata
  preview still succeed.

## A6.2 — Docling reader policy

### Change

- Replaced the 643-line `doclingReaderPolicy.service.ts` implementation with a
  38-line compatibility facade, so the adapter and existing tests keep the
  same public API.
- Moved reading-order repair, reference-boundary recovery and front-matter
  marking to `doclingReaderOrder.service.ts`.
- Moved table-caption association and numbered, clustered or untitled figure
  handling to `doclingCaptionPolicy.service.ts`.
- Moved the final keep/exclude decision for each normalized block to
  `doclingItemPolicy.service.ts`.
- The resulting services are 206, 207 and 166 lines; no replacement service
  exceeds the module's service-size limit.

### Locked behavior

- Abstract/Introduction ordering and reference-fragment merging use the same
  conditions and preserve the same item mutations.
- Author, affiliation, keyword, page-furniture and damaged distribution-notice
  filtering use the same patterns.
- Table captions retain the same spatial gap and overlap thresholds.
- Numbered and captionless figures retain the same sequence, size, aspect
  ratio, page-area, duplicate-image and body-prose checks.
- `DoclingReaderPolicyService` still exposes the five methods consumed by the
  adapter and contract tests.

### Verification

- TypeScript compilation and diff whitespace checks passed.
- Route contract: 99 feature routes plus the health route preserved.
- Contract baseline: 26/26 suites passed.
- Docling reader policy contract: 28/28 assertions passed.
- CALM pre-edit review identified the adapter and policy tests as the complete
  caller surface. Its post-edit transport closed while receiving the scoped
  raw diff, so this run does not claim a completed CALM post-edit scan.

### UI acceptance checklist

- Reimport one two-column academic PDF and confirm Abstract appears before
  Introduction without reordering later sections.
- Open a reader containing a table and confirm its caption appears once above
  the correct table.
- Open a reader containing numbered figures and confirm captions attach to the
  correct images without duplicate loose paragraphs.
- Open a scanned illustrated book and confirm substantial captionless images
  remain while repeated logos and decorative images remain excluded.
- Confirm Reader builds still records the same section count, chunk count,
  parser engine and completion state for the same source.

## A6.3 — Original PDF asset cache

### Change

- Reduced `originalPdfAsset.service.ts` from 529 lines to a 26-line facade.
- Removed the duplicated source/contribution cache implementations; both now
  load their own model and call one shared cache workflow.
- Moved the request/result contract to `dto/originalPdfAsset.dto.ts`.
- Moved PDF candidate discovery and stored-asset validation to
  `originalPdfCandidate.service.ts`.
- Moved PMC landing-page resolution, publisher-block detection and strict PDF
  byte validation to `originalPdfFetch.service.ts`.
- Moved temporary-file, upload, save, old-asset cleanup and rollback ordering
  to `originalPdfCacheWorkflow.service.ts`.

### Locked behavior

- Candidate priority remains source PDF, PMC PDF/HTML, supported Wiley DOI and
  direct PDF-like source URLs.
- Cloudinary URLs remain excluded from automatic external-source candidates.
- reCAPTCHA, publisher-blocked, preparing-download, HTML-not-PDF and fetch
  failure reasons remain distinct.
- A response is accepted when its content type is PDF or its bytes begin with
  the PDF magic header.
- The previous stored asset is deleted only after the replacement has uploaded
  and the document save has succeeded.
- Temporary files are removed in `finally`, including upload or save failures.
- Controller-facing function names, parameters, result fields and localized
  messages remain unchanged.

### Verification

- TypeScript compilation and diff whitespace checks passed.
- Route contract: 99 feature routes plus the health route preserved.
- Contract baseline: 26/26 suites passed.
- CALM post-edit review found only the two existing controller callers. Its
  high aggregate label comes from replacing inline return types with the named
  but structurally identical DTO, not from a runtime parameter change.

### UI acceptance checklist

- Cache a PDF for an approved source and confirm the success state and PDF
  viewer remain unchanged.
- Cache a PDF for a pending contribution and confirm its preview updates.
- Retry a source whose publisher blocks automated downloads and confirm the
  precise attempted-source failure remains visible.
- Force-refresh a source with an existing PDF, simulate a failed download and
  confirm the old PDF remains readable.
- Force-refresh successfully and confirm the replacement is stored before the
  previous asset is removed.

## A6.4 — Uploaded PDF import orchestration

### Change

- Reduced `uploadedPdfImport.service.ts` from 513 lines to 230 lines while
  preserving `runUploadedPdfImport` and `cancelUploadedPdfImport` as its public
  entry points.
- Moved the request/result contract to `dto/uploadedPdfImport.dto.ts`.
- Moved active-task registration, durable cancellation and terminal-state
  waiting to `uploadedPdfImportTask.service.ts`.
- Moved replacement commit, rollback, generated-image cleanup and failed-build
  history recording to `uploadedPdfImportLifecycle.service.ts`.
- Moved contribution/source loading and status/metadata updates to
  `uploadedPdfTarget.service.ts`.
- Moved the structured JATS/HTML attempt to
  `uploadedPdfStructuredImport.service.ts`.
- Moved the Docling compile branch, stage progress and result mapping to
  `uploadedPdfDoclingImport.service.ts`.
- Replaced the shared Mongoose target `any` values with the explicit
  `UploadedPdfTarget` union and named accessors for owner, identifiers and the
  stored original PDF.
- Removed inherited numbered-step comments; the coordinator now reads directly
  as validation, inspection, optional structured import and Docling fallback.
- Reordered the moderation actions in both the pending-source list and the
  moderation preview so `Duyệt` appears above `Từ chối`; button variants,
  validation and review handlers are unchanged.

### Locked behavior

- One active import remains registered per target; cancellation still waits
  for the replacement journal to reach a safe terminal state.
- A cancelled or failed replacement removes only newly created image assets
  and restores the previous reader.
- Rule-derived data is backed up and removed only immediately before a
  successful replacement commit.
- JATS/HTML remains an optional first attempt and falls back to Docling when
  the structured import does not succeed.
- Text-layer inspection still decides whether Docling OCR is required.
- Progress stages, duration estimates, success/failure history and localized
  controller-facing result fields keep their existing contracts.
- A compile-result failure still propagates a progress-finalization failure;
  the generic catch path remains best-effort, matching the previous behavior.

### Verification

- Backend TypeScript compilation passed.
- Route contract: 99 feature routes plus the health route preserved.
- Contract baseline: 26/26 suites passed.
- Frontend production build passed.
- Backend and frontend diff whitespace checks passed.
- CALM post-edit review reported low aggregate code-impact risk for the
  extracted orchestration and low UI risk for the button reorder.

### UI acceptance checklist

- Open both the pending-source list and a moderation preview; confirm `Duyệt`
  is above `Từ chối` and each action still uses its matching review flow.
- Import one text-layer PDF and confirm it builds with Docling without OCR.
- Import one scanned PDF and confirm OCR is selected automatically.
- Use a source with structured metadata and confirm successful JATS/HTML import
  remains possible; when it fails, confirm the same job falls back to Docling.
- Cancel an import after processing begins and confirm the cancellation state
  appears only after partial output is removed and the previous reader returns.
- Force a compile failure and confirm Reader builds records the failure reason,
  while the previous reader and its images remain available.
- Reimport successfully and confirm progress, duration, parser source, section
  count and chunk count remain visible in Reader builds.

## A6.5 — Remove the orphaned legacy HTML parser

### Audit result

- `htmlArticleParser.ts` contained 487 lines of older Frontiers, PLOS, PMC and
  generic HTML parsing logic.
- Repository search found no import, route, controller, service or test caller.
- The only matches reported by static indexing were self-references inside the
  file. The active structured-reader pipeline uses its own JATS, publisher HTML
  and generic HTML parsers.

### Change

- Removed the unreferenced `htmlArticleParser.ts` instead of splitting and
  preserving dead code.
- No replacement wrapper or placeholder was added because no compatibility
  import exists.

### Locked behavior

- Active Frontiers, JATS/XML, publisher HTML and generic HTML parsing remains
  implemented by the structured ingestion parsers.
- Source resolution, DOI/HTML reimport, structured-only enforcement and
  Docling fallback are unchanged.

### Verification

- Backend TypeScript compilation passed after deletion.
- Route contract: 99 feature routes plus the health route preserved.
- Contract baseline: 26/26 suites passed.
- CALM found no affected production symbol and reported low aggregate risk.

### UI acceptance checklist

- Reimport one accessible DOI/XML article and confirm its structured reader is
  still created.
- Reimport one supported publisher HTML article and confirm its headings,
  paragraphs, tables and figures remain available.
- Retry one blocked structured source and confirm the existing reader is kept.

## A6.6 — PDF metadata enrichment

### Change

- Reduced `pdfMetadataEnrichment.service.ts` from 430 lines to a 152-line
  coordinator whose main function exposes the complete enrichment pipeline.
- Moved the request/result boundary to `dto/pdfMetadataEnrichment.dto.ts`.
- Moved DOI, PMCID and ISBN normalization, conflict detection and resolver
  input construction to `pdfMetadataIdentifier.service.ts`.
- Moved canonical-first title, author, year, publisher, language and URL
  selection to `pdfMetadataSelection.service.ts`.
- Moved target loading, contribution status transitions, duplicate PMCID
  checks and model-specific persistence to
  `pdfMetadataPersistence.service.ts`.
- Replaced production `any` values in this metadata group with named DTOs and
  a typed Mongoose document boundary.
- Replaced repeated identifier branches with one typed reconciliation policy;
  each identifier still supplies its own normalizer and label.
- Simplified `pdfMetadataDetector.service.ts` comments and replaced its
  untyped existing-metadata argument with a small explicit interface.

### Locked behavior

- Stored canonical metadata remains stronger than resolver metadata, which
  remains stronger than embedded PDF hints.
- A detected identifier that conflicts with an existing identifier still
  blocks the external resolver and produces the same warning.
- An incomplete source can still use its existing identifier to retrieve
  missing metadata.
- PMCID uniqueness is checked against the correct collection before it is
  persisted; a duplicate keeps the previous identifier.
- Resolver failure remains non-fatal: PDF import continues and records a
  warning.
- Cloudinary asset URLs remain excluded from external article, HTML and PDF
  metadata fields.
- Structured-source preference remains JATS first, then HTML, then PDF text.
- Contribution-only extraction states and detected identifiers are not written
  to approved academic sources.

### Verification

- Backend TypeScript compilation passed.
- Route contract: 99 feature routes plus the health route preserved.
- Contract baseline: 26/26 suites passed.
- Six focused in-memory assertions passed for matching DOI normalization,
  identifier conflict blocking, resolver-title priority and structured-source
  selection.
- Strict unused-symbol compilation reported no issue in the new metadata
  files.
- CALM post-edit review reported low aggregate impact; its standalone server
  could not resolve the nested backend Git root, so the review used the scoped
  raw diff instead of the working-tree shortcut.

### UI acceptance checklist

- Import a PDF whose detected DOI matches its stored DOI and confirm missing
  title, authors or year are filled without an identifier warning.
- Import a PDF whose detected DOI conflicts with the stored DOI and confirm the
  original DOI remains visible with a conflict warning.
- Import a PMCID source that already belongs to another contribution/source
  and confirm the duplicate is not persisted.
- Import an ISBN book and confirm it remains metadata-only while its book
  metadata can still be filled.
- Simulate resolver failure and confirm Docling import continues from the PDF
  rather than reporting the whole reader build as failed.
- Confirm a source with usable JATS or HTML metadata still attempts that source
  before the Docling fallback.

## Cross-module pipeline-style audit

### Finding

- Earlier phases consistently preserved behavior and established capability
  boundaries, but not every coordinator yet followed the project's explicit
  top-down pipeline style.
- The Dream output finalizer already exposed a clear sequence of grounding
  steps. The main analysis and background runner still mixed those high-level
  steps with progress reporting, audit construction, persistence and error
  handling.
- Academic A6.3–A6.6 coordinators follow the intended style. Earlier
  contribution approval/submission, structured-reader import and reader
  reimport services still require the same style and type cleanup in their
  owning future correction phases.

### Dream correction

- Rewrote `runDreamAnalysis` as the visible sequence: prepare profile, retrieve
  dream context, retrieve grounded rules, build prompt, generate and validate,
  then build the audit result.
- Moved audit-result construction into
  `dreamAnalysisResult.service.ts`, a distinct persistence-response capability,
  instead of hiding it inside the main analysis function.
- Rewrote `runBackgroundAnalysis` as start, execute, commit, finalize and
  failure handling while preserving the run fence and write order.
- Removed untyped casts from pending-run recovery and gave the recovered
  background runner its actual Dream ID and sleep-context contract.

### Verification

- Backend TypeScript compilation passed.
- Route contract: 99 feature routes plus the health route preserved.
- Contract baseline: 26/26 suites passed, including all four Dream suites.
- Git whitespace checks passed.
- CALM scoped post-edit review reported low aggregate impact.

## Academic contribution pipeline correction

### Change

- Rewrote source submission as the visible sequence: resolve source, build
  identity conditions, handle an existing source/contribution, persist a new
  contribution, then record submission statistics.
- Moved duplicate-race persistence and rejected-contribution reactivation to
  `contributionSubmissionPersistence.service.ts`.
- Rewrote approval as the visible sequence: reject a duplicate, prepare the
  contribution, save the academic source, mark the contribution approved,
  record statistics, then promote or import its reader.
- Moved metadata normalization, reader-state preparation and AcademicSource
  construction to `contributionApprovalPreparation.service.ts`.
- Added `contributionWorkflow.dto.ts` so submission and approval no longer use
  untyped request, contribution, metadata or outcome values.
- Typed the review and approval-finalization boundaries and replaced the
  approval error cast with an unknown-safe message helper.

### Locked behavior

- Duplicate checks retain their original priority: approved source, active
  contribution, then rejected contribution reactivation.
- Unique-index collision recovery still re-queries the same identity fields
  and returns the same duplicate/reactivation responses.
- Approval still saves AcademicSource before updating SourceContribution.
- Preview reader promotion still moves the document, sections and chunks
  before recording the final reader status and counts.
- Full-text auto-import remains best-effort after approval and preserves all
  metadata-only, hybrid and copyright result codes.
- A preview contribution still in the transient `importing` state becomes
  `imported` when its already-built preview reader is promoted; this avoids
  writing a value rejected by the AcademicSource schema.

### Verification

- Backend TypeScript compilation passed.
- Route contract: 99 feature routes plus the health route preserved.
- Contract baseline: 26/26 suites passed.
- Manual caller review confirmed submission, preview and review controllers
  remain the only external callers and keep the same argument order.
- CALM scoped review found no unindexed file and identified the expected high
  signature risk from replacing `any` with concrete contracts; compilation,
  caller review and the full baseline cover those call sites.

### UI acceptance checklist

- Preview and submit a new DOI or URL contribution.
- Submit the same approved source and confirm the existing-source warning.
- Submit the same pending contribution and confirm the pending warning.
- Resubmit a rejected contribution and confirm it returns to the pending list.
- Approve a metadata-only source and confirm it remains readable only when
  full text is actually available.
- Approve an uploaded PDF or preview reader and confirm its reader, chunks,
  statistics and approval response remain available.

## Academic structured reader re-import correction

### Change

- Rewrote `reimportReader` as the visible sequence: load target, resolve a
  structured candidate, create the replacement context, import, then either
  commit or roll back.
- Moved stored URL, legacy AcademicDocument URL and DOI/PMCID candidate
  recovery to `readerReimportCandidate.service.ts`.
- Added `readerReimport.dto.ts` for the source, candidate and response
  boundaries.
- Replaced inline failure, commit and exception branches with named handlers;
  the workflow function is now at the top of the file.
- Removed untyped filters, source candidates, document reads and error casts
  from this coordinator.

### Locked behavior

- Candidate priority remains source fields, legacy document fields, DOI
  resolution, then identifier-derived structured candidates.
- Direct PDF URLs remain excluded from this structured-only action.
- A replacement run is still created only after a usable candidate exists.
- Failed or cancelled imports still remove newly created images and restore
  the previous reader snapshot.
- Sources without an existing reader still receive the same failed state;
  sources with an existing reader keep it.
- Rule V3 evidence is backed up and removed only after the new reader import
  succeeds, immediately before replacement commit.
- Old reader images are deleted only after a successful commit.

### Verification

- Backend TypeScript compilation passed.
- Route contract: 99 feature routes plus the health route preserved.
- Contract baseline: 26/26 suites passed.
- CALM scoped review reported medium structural risk for the new coordinator
  contracts and no unindexed files; both controller callers keep the same
  `reimportReader(sourceId, moderatorId)` signature.

### UI acceptance checklist

- Use `Nhập từ DOI/HTML` on a source with a valid structured URL and confirm
  the reader is replaced successfully.
- Use it on a source with only a PDF and confirm the structured-source error
  still recommends Docling instead of reporting success.
- Force a blocked or invalid structured source and confirm the previous reader
  remains visible.
- Cancel during re-import and confirm the previous reader and its images return.
- Complete a re-import and confirm old Rule V3 data is cleared only after the
  replacement succeeds.

## Academic reader ownership cleanup

### Change

- Added one owner-based cleanup pipeline for approved sources and preview
  contributions.
- Source deletion now discovers every linked contribution before removing
  documents, sections, chunks, Rule V3 data, reader images and stored PDFs.
- Contribution rejection now clears reader build history and import progress
  together with the persisted reader.
- Active reader replacement runs are cancelled and rolled back before cleanup;
  their backups and terminal run records are then removed.
- Reader images and original files are deleted only after database cleanup and
  only when no remaining source still references them.
- Moderation preview now places Reject on the left and Approve on the right.

### Data repair

- The read-only audit found 8 ownerless documents, 235 ownerless sections,
  5 ownerless replacement runs and 1 rejected contribution with Reader history.
- The one-time repair used the owner cleanup pipeline, then removed its
  temporary script.
- The verification audit returned zero for orphan documents, sections, chunks,
  replacement runs and rejected contributions retaining Reader history.

### Locked behavior

- Public source deletion and contribution review routes are unchanged.
- MongoDB replica deployments keep transactional deletion; standalone
  deployments keep ordered deletion.
- Duplicate DOI contributions and contributions linked to an approved source
  are cleaned as one ownership group, preventing stale reader data on re-add.
- A file or image shared by another surviving source is preserved.

### Verification

- Backend TypeScript compilation passed.
- Frontend production build passed.
- Route contract: 99 feature routes plus the health route preserved.
- Contract baseline: 26/26 suites passed.

## A7.1 — Canonical Reader translation execution

### Change

- Kept `translateReaderTargets` as the visible translation pipeline and reduced
  it from 461 to 259 lines.
- Moved provider batching, concurrency, timeout, client abort and output-size
  enforcement to `readerTranslationExecution.service.ts`.
- Moved translated/failed target mapping and final response construction to
  `readerTranslationResponse.service.ts`.
- Removed the generated phase banner and kept the public service signature
  unchanged.
- Corrected the moderation-list action order to Preview, Reject, Approve.
- Made pending moderation cards keyboard-accessible preview links while
  preserving independent PDF links, buttons and form controls inside them.

### Locked behavior

- Approved and moderation-preview routes still use the same translation entry
  point and canonical identity checks.
- Provider resolution, batch size, concurrency, timeout, protected-token
  checks and cumulative output limits are unchanged.
- Translation remains an in-memory display overlay and performs no database
  writes.

### Verification

- Backend TypeScript compilation passed.
- Canonical Reader translation contract: 131/131 assertions passed.
- Frontend production build passed.

## A7.2 — Academic closure audit and Docling boundaries

### Change

- Split Docling runtime probing, temporary workspace safety, canonical text
  flow and import support out of the client, adapter and import pipeline.
- Reduced the three mixed Docling files from 396/367/364 lines to
  260/212/197 lines without changing their public entry points.
- Moved the shared item-policy result type out of the reader-policy facade,
  removing the final import cycle inside the Academic module.
- Kept JATS and Frontiers traversal intact because each is one stateful DOM
  parser and currently has no direct parser fixture suite; splitting either
  during this behavior-preserving phase would add risk without a contract.

### Locked behavior

- `DoclingClientService.isAvailable`, `DoclingClientService.extractPdf`,
  `DoclingAdapterService.mapToCanonicalBlocks` and `runDoclingPdfImport`
  retain their signatures.
- OCR selection, timeout, cancellation, artifact validation, figure upload,
  reader compilation, title detection and rollback order are unchanged.
- Academic routes, controller response contracts and database ownership
  cleanup remain unchanged.

### Verification

- Academic structure contains 17 controllers, 10 DTO files, 7 models and
  capability-grouped services; the largest controller is 107 lines.
- DTO files contain validation contracts rather than empty placeholders.
- Academic dependency audit: 158 production TypeScript files and zero cycles.
- Docling contracts: metadata 2/2, text repair 15/15 and reader policy 28/28.
- Backend TypeScript compilation passed.
- Route contract: 99 feature routes plus the health route preserved.
- Contract baseline: 26/26 suites passed.

## A7.3 — Academic contribution entry

### Change

- Reduced the contribution entry screen from four choices to two:
  PDF upload first, followed by DOI/PMCID/academic-link lookup.
- Replaced the separate DOI and URL forms with one input that normalizes raw
  DOI, doi.org URLs, PMCID and article URLs into the existing resolver request.
- Removed the ISBN choice, state, validation, preview row and submit field from
  the active frontend contribution flow.
- Delayed lookup validation and server errors until the user submits with the
  button or Enter; editing the input clears the previous error.
- Kept backend ISBN metadata support for existing records and identifiers
  detected inside uploaded PDFs.

### Locked behavior

- PDF contributions still use the existing upload-preview-confirm pipeline.
- DOI, PMCID and academic links still use the same preview and contribution
  endpoints, followed by the DOI/HTML/XML reader pipeline after moderation.
- The metadata confirmation screen and duplicate-source handling are unchanged.

### Verification

- Frontend TypeScript and production build passed.
- DOI, PMCID, doi.org URL, publisher article URL and invalid-input normalization
  were checked directly.
