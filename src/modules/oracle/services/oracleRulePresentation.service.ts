export interface OracleLocalizedText {
  vi: string;
  en: string;
}

function normalized(value: unknown): string {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

export function localizeOracleRuleStatement(rule: any): OracleLocalizedText {
  const original = normalized(rule?.statement || rule?.ruleStatement);
  return { vi: original, en: original };
}

export function localizeOracleVerificationQuestion(
  rule: any,
  question: unknown,
): OracleLocalizedText | undefined {
  const original = normalized(question);
  if (!original) return undefined;
  void rule;
  return { vi: original, en: original };
}
