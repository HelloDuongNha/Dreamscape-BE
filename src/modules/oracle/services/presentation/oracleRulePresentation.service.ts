import { classifyRuleV3VerificationKind } from '../../../rules_v3/services/retrieval/ruleV3DreamApplication.service';

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
  const vi = normalized(rule?.localizedStatement?.vi);
  const en = normalized(rule?.localizedStatement?.en);
  return {
    vi: vi || original,
    en: en || original,
  };
}

export function localizeOracleVerificationQuestion(
  rule: any,
  question: unknown,
): OracleLocalizedText | undefined {
  const original = normalized(question);
  if (!original) return undefined;
  const vi = normalized(rule?.localizedVerificationQuestion?.vi);
  const en = normalized(rule?.localizedVerificationQuestion?.en);
  if (vi && en && vi !== en) return { vi, en };
  return buildOracleCitationVerificationQuestion(rule);
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
  const observableQuestion = buildObservableQuestion(
    classifyRuleV3VerificationKind(rule),
  );
  if (observableQuestion) return observableQuestion;
  return {
    vi: 'Trong hoàn cảnh thật liên quan đến giấc mơ này, có chi tiết ngoài đời nào tương ứng trực tiếp với điều được mô tả trong giấc mơ không?',
    en: 'In the real situation behind this dream, is there a waking-life detail that directly corresponds to what the dream described?',
  };
}

// Translate academic verification kinds into observable, everyday questions.
function buildObservableQuestion(kind: string): OracleVerificationQuestion | null {
  const questions: Record<string, OracleVerificationQuestion> = {
    recent_experience_incorporation: {
      vi: 'Trong vài ngày trước giấc mơ này, có trải nghiệm, ký ức mới hoặc cảm xúc cụ thể nào ngoài đời xuất hiện lại trong giấc mơ không?',
      en: 'In the few days before this dream, did a specific waking experience, new memory, or emotion reappear in the dream?',
    },
    anticipated_event: {
      vi: 'Giấc mơ này có hướng tới một sự kiện có thật mà bạn đang chờ đợi hoặc chuẩn bị không?',
      en: 'Did this dream involve a real event that you are awaiting or preparing for?',
    },
    current_stress: {
      vi: 'Trong những ngày gần đây, có áp lực cụ thể ngoài đời nào xuất hiện lại trong cảm xúc hoặc diễn biến của giấc mơ không?',
      en: 'In recent days, did a specific waking-life pressure reappear in the emotions or events of this dream?',
    },
    waking_concern_incorporation: {
      vi: 'Trong tuần trước giấc mơ, bạn có thường xuyên nghĩ hoặc lo về một việc ngoài đời cũng xuất hiện trong giấc mơ không?',
      en: 'During the week before this dream, were you repeatedly thinking or worrying about a waking-life matter that also appeared in the dream?',
    },
    weak_association_recombination: {
      vi: 'Ít nhất hai chi tiết tưởng như không liên quan trong giấc mơ có gợi lại những trải nghiệm riêng biệt ngoài đời của bạn không?',
      en: 'Did at least two seemingly unrelated dream details recall separate waking-life experiences for you?',
    },
    external_sleep_stimulus: {
      vi: 'Trong lúc ngủ hoặc ngay khi tỉnh dậy, có âm thanh, ánh sáng hay cảm giác cơ thể thật nào giống một chi tiết trong giấc mơ không?',
      en: 'While sleeping or just after waking, was there a real sound, light, or bodily sensation that resembled a detail in the dream?',
    },
  };
  return questions[kind] || null;
}
