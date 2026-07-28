export interface OracleLocalizedText {
  vi: string;
  en: string;
}

export interface OracleVerificationQuestion {
  vi: string;
  en: string;
}

export const ORACLE_CITATION_QUESTION_VERSION = 'v3';

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

// Builds one case-level question from the rule's structured facets.
export function buildOracleCitationVerificationQuestion(rule: any): OracleVerificationQuestion {
  const statement = normalized(rule?.statement || rule?.ruleStatement);
  const condition = normalized(rule?.conditions?.[0]);
  const tags = (rule?.dreamFeatureTags || []).map((item: unknown) =>
    normalized(item).toLocaleLowerCase('en'));
  const facets = `${statement} ${condition} ${tags.join(' ')}`.toLocaleLowerCase('en');
  const statementText = statement.toLocaleLowerCase('en');
  const futureOriented = /future-oriented|future event|anticipated|prospective/iu.test(facets);
  const lateNight = /later in the night|final quartile|near awakening|gần sáng|cuối giấc ngủ/iu.test(facets);
  if (futureOriented && lateNight) {
    return {
      vi: 'Giấc mơ này có xảy ra gần sáng hoặc vào phần cuối giấc ngủ, đồng thời hướng đến một sự kiện tương lai có thật mà bạn đang chờ đợi hoặc chuẩn bị không?',
      en: 'Did this dream occur near awakening or late in your sleep while also involving a real future event that you are awaiting or preparing for?',
    };
  }
  const hasPastFuturePair = /(?:both|đồng thời).*(?:past|quá khứ).*(?:future|tương lai)|past event.+(?:and|và).+future event|specific past.+anticipated future/iu
    .test(statementText);
  if (hasPastFuturePair) {
    return {
      vi: 'Trong hoàn cảnh thật liên quan đến giấc mơ này, nó có đồng thời gợi lại một sự kiện cụ thể đã xảy ra và một sự kiện tương lai có thật mà bạn đang chờ đợi hoặc chuẩn bị không?',
      en: 'In the real situation behind this dream, does it involve both a specific past event and a real future event that you are awaiting or preparing for?',
    };
  }
  const comparesPastAndFuture = /past.+(?:than|versus|vs\.?).+future|quá khứ.+(?:hơn|so với).+tương lai/iu
    .test(statementText);
  if (comparesPastAndFuture) {
    return {
      vi: 'Giấc mơ này chủ yếu gợi lại một sự kiện quá khứ cụ thể hơn là hướng đến một sự kiện tương lai cụ thể không?',
      en: 'Does this dream mainly recall a specific past event rather than point to a specific future event?',
    };
  }
  if (/sleep onset|bắt đầu giấc ngủ|mới vào giấc ngủ/iu.test(facets)) {
    return {
      vi: 'Giấc mơ này có xuất hiện lúc bạn mới bắt đầu ngủ và gợi lại một sự kiện quá khứ cụ thể không?',
      en: 'Did this dream occur as you were first falling asleep and recall a specific past event?',
    };
  }
  const meaningfulCondition = condition
    && !/^(?:during sleep|while sleeping|in dreams?|khi ngủ|trong giấc mơ)$/iu.test(condition);
  if (meaningfulCondition) {
    return {
      vi: `Trong trường hợp thật của bạn, điều kiện “${condition}” có phù hợp với giấc mơ này không?`,
      en: `In your real situation, does the condition “${condition}” fit this dream?`,
    };
  }
  return {
    vi: `Lập luận “${statement}” có phù hợp với hoàn cảnh thật liên quan đến giấc mơ này không?`,
    en: `Does the argument “${statement}” fit the real situation behind this dream?`,
  };
}
