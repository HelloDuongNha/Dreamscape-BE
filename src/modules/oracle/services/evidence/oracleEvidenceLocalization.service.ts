import { cleanOracleEvidenceClaim } from '../../../../shared/evidence/evidenceClaim';
import { oracleEvidenceClaimClusterKey } from '../../../../shared/evidence/evidenceClaimMatching';

export interface LocalizedOracleEvidenceClaim {
  key: string;
  vi: string;
  en: string;
}

const LOCALIZED_CLAIMS: Record<string, { vi: string; en: string }> = {
  'mechanism:memory-incorporation__context:dream': {
    vi: 'Nội dung giấc mơ có thể tái kết hợp các mảnh ký ức từ trải nghiệm khi thức.',
    en: 'Dream content may recombine memory fragments from waking experience.',
  },
  'mechanism:memory-recombination__context:future-oriented-dream': {
    vi: 'Nội dung giấc mơ có thể tái kết hợp ký ức quá khứ với mối quan tâm hoặc nhiệm vụ tương lai.',
    en: 'Dream content may recombine past memories with future concerns or anticipated tasks.',
  },
  'context:late-sleep__outcome:future-oriented-dream-prevalence': {
    vi: 'Giấc mơ hướng tới tương lai có thể trở nên phổ biến hơn vào phần cuối của giấc ngủ.',
    en: 'Future-oriented dreams may become more common later in the sleep period.',
  },
  'state:anxiety__outcome:creative-coping-or-improvisation': {
    vi: 'Lo âu trong giấc mơ có thể liên quan đến việc thử nghiệm các phương án giải quyết vấn đề sáng tạo.',
    en: 'Anxiety in dreams may be associated with exploring creative problem-solving alternatives.',
  },
  'relation:action-planning__outcome:stress-reduction': {
    vi: 'Chuyển lo âu thành hành động hoặc kế hoạch cụ thể có thể liên quan đến việc giảm căng thẳng.',
    en: 'Turning anxiety into concrete action or planning may be associated with reduced stress.',
  },
  'mechanism:weak-association__outcome:creative-divergent-thinking': {
    vi: 'Kích hoạt các liên kết yếu trong giấc mơ có thể liên quan đến tư duy sáng tạo, linh hoạt hoặc phân kỳ.',
    en: 'Activation of weak associations in dreams may be related to creative, flexible, or divergent thinking.',
  },
  'mechanism:sleep-information-processing__outcome:insight-or-surprise': {
    vi: 'Xử lý thông tin trong giấc ngủ có thể liên quan đến cảm giác sáng tỏ hoặc bất ngờ khi tỉnh dậy.',
    en: 'Information processing during sleep may be associated with insight or surprise upon awakening.',
  },
  'context:work-pressure__outcome:sleep-or-memory-intrusion': {
    vi: 'Áp lực công việc có thể liên quan đến việc các mối bận tâm khi thức xuất hiện trong giấc ngủ hoặc nội dung giấc mơ.',
    en: 'Work pressure may be associated with waking concerns carrying into sleep or dream content.',
  },
};

export function localizeOracleEvidenceClaim(claim: string): LocalizedOracleEvidenceClaim {
  const cleanClaim = cleanOracleEvidenceClaim(claim);
  const key = oracleEvidenceClaimClusterKey(cleanClaim);
  const localized = LOCALIZED_CLAIMS[key];
  return localized ? { key, ...localized } : { key, vi: cleanClaim, en: cleanClaim };
}
