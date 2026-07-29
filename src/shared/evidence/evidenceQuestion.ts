export function resolveEvidenceQuestionRuleIds(question: any): string[] {
  return [...new Set<string>((question?.ruleIds || [question?.ruleId])
    .map((id: unknown) => String(id || '').trim())
    .filter(Boolean))];
}
