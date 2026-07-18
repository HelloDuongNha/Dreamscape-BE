# Cutover Strategy: Rule V3 Isolated Namespace

To guarantee zero behavior disruption, zero compatibility regressions, and zero dual-write bugs, this patch implements **Strategy B**.

## Strategy Overview

1. **Isolation:** The Rule V3 models and the exact citation locator service reside exclusively inside isolated file spaces:
   - Models: `src/models/rulesV3/`
   - Citation Locator: `src/services/rules/exactCitationLocator.service.ts`
   - Tests: `src/services/rules/exactCitationLocator.test.ts`
2. **Coexistence:** The legacy engine, models (`PendingKnowledgeRule`, `VerifiedKnowledgeRule`, `KnowledgeRuleEvidence`, `AcademicRuleExtractionRun`), routes, controllers, and frontend code remain fully active and untouched in production.
3. **No Database Writes:** No Rule V3 writes occur in any active production code path during this patch. The V3 models are only written to and verified by our deterministic unit/smoke test suite.
4. **No Dual Writing:** There is zero dual-writing. A clean cutover will happen when the first active vertical slice is connected.

## Future Removal/Migration Steps

When the Rule V3 active extractor slice is connected in a future patch:
1. Delete the legacy models:
   - `src/models/PendingKnowledgeRule.ts`
   - `src/models/VerifiedKnowledgeRule.ts`
   - `src/models/KnowledgeRuleEvidence.ts`
   - `src/models/AcademicRuleExtractionRun.ts`
2. Update the controllers (e.g. `moderationController.ts`, `knowledgeEvidenceController.ts`) to query and write exclusively to the new V3 collection/model schemas.
3. Update the frontend interfaces in `ruleCandidateApi.ts` and components in `RuleCandidatesView.vue` to match the simplified V3 backend fields.
4. Because the local/production rule database has zero active rules (confirmed empty during pre-implementation audit), no data migration script is required. Clean cutover can be done instantly.
