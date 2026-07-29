import type {
  OracleSourceInvalidationPlan,
} from '../../../../oracle/services/lifecycle/oracleSourceInvalidationPlan.service';

// Removes feedback for deleted questions while preserving another source for the same rule.
export function filterDreamFeedbackAfterSourceInvalidation(
  feedbackRows: any[],
  invalidVerificationKeys: Set<string>,
  plan: OracleSourceInvalidationPlan,
): any[] {
  return feedbackRows.filter((feedback) => {
    const verificationKey = String(feedback.verificationKey || '').trim();
    if (verificationKey) return !invalidVerificationKeys.has(verificationKey);
    return !plan.ruleIds.includes(String(feedback.ruleId || ''));
  });
}
