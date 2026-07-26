import { classifyRuleV3VerificationKind } from '../../rules_v3/services/ruleV3DreamApplication.service';

export interface OracleLocalizedText {
  vi: string;
  en: string;
}

function normalized(value: unknown): string {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

export function localizeOracleRuleStatement(rule: any): OracleLocalizedText {
  const original = normalized(rule?.statement || rule?.ruleStatement);
  const text = original.toLocaleLowerCase('en');

  if (/future[\s-]+oriented dreams?.*(?:later in the night|time of night)|later in the night.*future[\s-]+oriented dreams?/iu.test(text)) {
    return {
      vi: 'Giấc mơ hướng tới tương lai xuất hiện với tỷ lệ cao hơn về cuối đêm.',
      en: 'Future-oriented dreams become proportionally more common later in the night.',
    };
  }
  if (/dreams?.*(?:specific past events?).*(?:anticipated future events?)|past events?.*(?:and|with).*(?:future events?)/iu.test(text)) {
    return {
      vi: 'Giấc mơ có thể liên quan đồng thời đến một sự kiện quá khứ cụ thể và một sự kiện tương lai đang được chờ đợi.',
      en: 'Dreams can relate to both a specific past event and an anticipated future event.',
    };
  }
  if (/weak associations?.*(?:creative|flexible|divergent)|(?:creative|flexible|divergent).*(?:weak associations?)/iu.test(text)) {
    return {
      vi: 'Việc kích hoạt các liên kết yếu có thể là một phần quan trọng của tư duy sáng tạo, linh hoạt và phân kỳ trong khi mơ.',
      en: 'The activation of weak associations may be an important component of creative, flexible, and divergent thinking during dreaming.',
    };
  }
  const looksVietnamese = /[ăâđêôơưà-ỹ]/iu.test(original);
  return looksVietnamese
    ? { vi: original, en: original }
    : { vi: original, en: original };
}

export function localizeOracleVerificationQuestion(
  rule: any,
  question: unknown,
): OracleLocalizedText | undefined {
  const original = normalized(question);
  if (!original) return undefined;
  const kind = classifyRuleV3VerificationKind(rule);

  if (/bảy ngày tới.*buổi họp hoặc trình bày/iu.test(original)) {
    return {
      vi: original,
      en: 'In the next seven days, do you have a real meeting or presentation directly related to the project in this dream?',
    };
  }
  if (/bảy ngày tới.*việc quan trọng.*đánh giá/iu.test(original)) {
    return {
      vi: original,
      en: 'In the next seven days, do you have an important event where other people will evaluate your result?',
    };
  }
  if (kind === 'anticipated_event') {
    return {
      vi: original,
      en: 'In the next seven days, do you have an important event where other people will evaluate your result?',
    };
  }
  if (kind === 'implausible_future_scenario') {
    return {
      vi: original,
      en: 'In the next seven days, do you have a real meeting or presentation directly related to the project in this dream?',
    };
  }
  if (kind === 'weak_association_recombination') {
    if (/ba ngày|three days/iu.test(original)) {
      return {
        vi: original,
        en: 'In the three days before the dream, were you actively looking for a new way to present or solve the project?',
      };
    }
    return {
      vi: original,
      en: 'In the seven days before the dream, were at least two of these dream details recalled from separate waking-life events?',
    };
  }
  if (kind === 'waking_prospective_difference') {
    return {
      vi: original,
      en: 'In the 24 hours before sleep, did you deliberately rehearse or plan for the presentation mentioned in the dream?',
    };
  }
  return /[ăâđêôơưà-ỹ]/iu.test(original)
    ? { vi: original, en: original }
    : { vi: original, en: original };
}
