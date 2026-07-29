# Oracle refactoring audit

## Verified status — 2026-07-29

This audit was re-opened after the citation lifecycle exposed behavior that the
previous “completed” checklist had not actually verified.

- `executeOracleRun` is the single production pipeline: claim run, retrieve
  conversation and grounding, call the provider, validate/finalize citations,
  capture Evidence Needed, persist, and publish events.
- Claim normalization and claim matching used by both Oracle and Dream now live
  in `src/shared/evidence/`.
- Dream citation presentation, questions, resolution, notification, and source
  invalidation now belong to `src/modules/dream/services/analysis/evidence/`;
  Oracle no longer owns those Dream adapters.
- Reconciliation may expose pending rules as candidates, but only a `verified`
  rule may replace `[?]`, create a citation question, or resolve an evidence
  need.
- Reconnect now refreshes the visible Dream and active Oracle thread so a
  missed socket event does not leave stale citation state on screen.
- Backend typecheck and the frontend production build pass on the current
  worktree. No database-writing migration or mass Dream reanalysis was run.

Known debt remains: `src/shared/evidence/evidenceClaim.ts` and
`evidenceClaimMatching.ts` still contain bounded bilingual concept patterns.
They are centralized and shared, but they have not yet been replaced by a
fully structured multilingual representation. The earlier audit statement
claiming all phrase clusters were removed was inaccurate.

## Audit boundary

- This document is a read-only audit and roadmap. No Oracle runtime behavior is changed in this step.
- Rules V3 remains the source of approved arguments, evidence excerpts, scores, and citation feedback.
- Oracle owns conversations, grounded answers, citation placement, evidence needs, follow-up questions, and run lifecycle.
- Refactoring must preserve every existing API contract and visible behavior before any product improvement is considered.

## Behavior that must not change

- Threads remain isolated per account and keep their ordering, pinning, branching, editing, and deletion behavior.
- A submitted turn is idempotent; retries cannot create duplicate user or assistant messages.
- Background runs survive navigation and reload, expose one consistent progress state, and support cancellation.
- `chat`, `dream_analysis`, and `creative_continuation` modes keep their current intent and output boundaries.
- Academic citations use deterministic `[n]` numbering; unsupported research claims use `[?]`.
- Removing a source returns affected citations to `[?]`, resets obsolete feedback, and reopens the evidence need.
- Re-imported EN/VI evidence can resolve an equivalent need by meaning rather than exact wording.
- Citation questions remain tied to the current dream case and update the single Rules V3 argument score once.
- Evidence-needed moderation never exposes a user's private conversation.
- Model credentials, provider errors, and stored conversations remain private to the authorized user or moderator.

## Code standard

- Controllers translate HTTP input/output only and stay below 200 lines.
- Runtime services should target 300 lines and always have one clear owner;
  ownership and pipeline readability take precedence over a mechanical split.
- The main orchestration function appears first and reads as the complete pipeline.
- Conditional branches call named functions; invalid input and terminal states return early.
- DTOs own request parsing and validation instead of controllers or services.
- Prompts, provider adapters, output validation, persistence, lifecycle, and presentation remain separate.
- Tests live under `tests/`, never beside runtime services.
- Fixed phrases or dream-specific regular expressions cannot be added to pass one example.
- Shared helpers move to `src/shared/` only when at least two real modules use them.
- Refactoring changes structure and clarity, not score formulas or product behavior.

## Current snapshot

| Area | Current size | Main issue |
| --- | ---: | --- |
| `oracleController.ts` | 947 lines | Thread CRUD, turn submission, citation details/feedback, branching, cancellation, status, and SSE share one controller. |
| `oracleEvidenceGap.service.ts` | 1,133 lines | Claim cleanup, fixed phrase clusters, matching, capture, reconciliation, citation patching, Dream patching, and presentation are mixed. |
| `oracleRun.service.ts` | 808 lines | Prompting, provider selection, timing, streaming, suggestions, citation validation, persistence, and orchestration are mixed. |
| `oracleRetrieval.service.ts` | 257 lines | One large function retrieves personal dreams, Rules V3 arguments, citations, and verification questions. |
| Oracle DTOs | one-line placeholder | Request parsers currently live in `services/oracle.validation.ts`. |
| Oracle services | 13 flat runtime files | Ownership is not visible from the folder structure. |
| Oracle tests | 2 files mixed with services | Persistence and quality contracts sit beside runtime code. |
| Frontend Oracle shell | 194–797 lines per component | API/state, navigation, presentation, citation UI, and run lifecycle are concentrated in several large files. |

## Target ownership map

| Folder | Responsibility |
| --- | --- |
| `controllers` | Thin thread, turn, citation, run, credential, and evidence-gap HTTP adapters. |
| `dto` | Thread, turn, citation, run, credential, and evidence-gap request parsing. |
| `services/threads` | Thread CRUD, ordering, pinning, branching, editing, and ownership checks. |
| `services/runs` | Run orchestration, timing, events, cancellation, recovery, and terminal status. |
| `services/grounding` | Personal-dream retrieval, Rules V3 retrieval, citation assembly, and case questions. |
| `services/evidence` | Claim representation, semantic matching, capture, reconciliation, citation patching, and presentation. |
| `services/providers` | Prompt construction, model adapters, output validation, and credentials. |
| `services/persistence` | Idempotent turn/run writes and transaction boundaries. |
| `services/lifecycle` | Source invalidation, rollback, cleanup, and recovery. |
| `services/presentation` | EN/VI response mapping without changing stored bilingual content. |
| `tests` | Contract tests grouped by controller, run, grounding, evidence-gap, persistence, and provider ownership. |

## Phases

1. **O1 — Baseline and DTO boundary**
   - [x] Record the current API, persistence, run, citation, evidence-gap, EN/VI, and account-isolation contracts.
   - [x] Move request parsers from `oracle.validation.ts` into real DTO files without changing accepted payloads.
   - [x] Move Oracle tests into ownership folders under `tests/`.
   - [x] Run the complete baseline before and after relocation.

2. **O2 — Controller boundaries**
   - [x] Split thread, turn, citation, and run endpoints into focused controllers.
   - [x] Move citation-detail assembly and fallback-question construction into services.
   - [x] Remove direct model orchestration from the migrated controllers.
   - [x] Keep every controller below 200 lines.

3. **O3 — Run pipeline**
   - [x] Make `executeOracleRun` a readable pipeline: claim run, load context, ground, build prompt, call provider, validate output, persist, publish terminal state.
   - [x] Separate timing, event streaming, suggestions, citation validation, and final response assembly.
   - [x] Preserve retry, cancellation, reload recovery, and idempotency.

4. **O4 — Grounding and retrieval**
   - [x] Separate personal-dream retrieval, Rules V3 retrieval, citation ranking, and verification-question selection.
   - [x] Keep one structured grounding result shared by chat and post analysis where their behavior is genuinely common.
   - [x] Preserve deterministic citation numbering and highest-available appended citations.

5. **O5 — Evidence-gap lifecycle**
   - [x] Split the 1,133-line service into focused evidence lifecycle services used by Academic, Rules V3, Dream, and Oracle.
   - [ ] Replace the remaining bounded bilingual concept patterns with a structured multilingual representation without changing current matches.
   - [x] Keep `unresolved`, `candidate_found`, and `resolved` as explicit states.
   - [x] Preserve deletion reset, duplicate merging, automatic re-linking, private-chat protection, and citation patching.

6. **O6 — Persistence and lifecycle safety**
   - [x] Make turn creation, run creation, assistant persistence, cancellation, rollback, and source invalidation explicit transaction steps.
   - [x] Verify concurrent retry and account-switch isolation.
   - [x] Remove empty fields at the write boundary only where omission is behaviorally equivalent.

7. **O7 — Provider and credential boundary**
   - [x] Move system prompts and provider-specific schemas out of orchestration.
   - [x] Normalize provider failures without leaking credentials or raw internal errors.
   - [x] Preserve configured model selection and existing fallback behavior.

8. **O8 — Frontend shell and stores**
   - [x] Separate thread navigation, turn submission, run tracking, citation presentation, and model settings.
   - [x] Reset account-scoped stores immediately when identity changes.
   - [x] Reuse existing feedback, modal, progress, queue, and notification components.
   - [x] Keep browser back/forward state, mobile layout, EN/VI, and accessibility intact.

9. **O9 — Final cleanup and verification**
   - [x] Remove superseded files rather than leaving re-export-only compatibility shells.
   - [x] Confirm no flat Oracle runtime service or test remains.
   - [x] Replace long generated comments with concise one-line ownership comments.
   - [x] Reduce unjustified `any` values and document any boundary that must remain dynamic.
   - [ ] Run the manual delete/re-import lifecycle checklist on the current data set.

## Verification after every phase

### Automated commands that currently exist

- Backend: `npm run typecheck`
- Backend route contract: `npm run verify:route-contract`
- Frontend production build: `npm run build`
- Both repositories: `git diff --check`

The older Oracle-specific test scripts listed here did not exist in the
current `package.json` and therefore must not be reported as passing.

### Manual UI

1. Switch from account A to account B without refreshing; no thread or message from A may remain.
2. Send one message once; exactly one complete user bubble appears on the right before and after reload.
3. Create, rename, pin, branch, edit, and delete a thread; browser back/forward restores the selected state.
4. Start a run, navigate away, return, cancel, and retry; progress and terminal notifications remain consistent.
5. Open a citation, answer Yes/No/Not sure, unselect, and verify one score update with the correct current rule.
6. Delete a cited source; its `[n]` returns to `[?]`, feedback resets, and one unresolved evidence need appears.
7. Re-import equivalent EN or VI evidence; the current argument and question are rebuilt, and the citation is appended as the highest `[n]`.
8. Verify evidence-needed moderation shows only the AI claim passage and never opens another user's private chat.
9. Generate a dream analysis and a creative continuation in both EN and VI; structure, sources, questions, and notifications remain localized.
10. Search conversations and messages with English, Vietnamese with accents, and Vietnamese without accents.

## Risk and sequencing

- Evidence-gap refactoring has the largest blast radius because Academic approval, Rules V3 extraction, Dream posts, and Oracle citations call it. Keep its public facade stable until all callers are contract-tested.
- Split the controller and run pipeline before replacing evidence matching; do not combine structural relocation with semantic behavior changes.
- Do not introduce a Python microservice during this refactor. The current priority is one understandable TypeScript pipeline with measured boundaries.
- Do not alter the Rules V3 score formula while reorganizing Oracle. Oracle displays and submits feedback; Rules V3 remains the score owner.

## Definition of done

- All controllers are below 200 lines; runtime services have one clear owner and
  stay close to the 300-line guideline.
- DTOs contain real parsers and no placeholder-only file remains.
- Oracle runtime files and tests are grouped by responsibility with no compatibility shells.
- No example-specific keyword list is used as a substitute for semantic handling.
- Account isolation, idempotency, queueing, cancellation, citation lifecycle, source invalidation, feedback scoring, and EN/VI pass automated and manual checks.
- The final pipeline can be explained step by step in a report without reading framework or provider details.
