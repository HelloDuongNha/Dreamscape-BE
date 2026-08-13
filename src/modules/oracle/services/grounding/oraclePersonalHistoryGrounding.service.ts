import Dream from '../../../dream/models/Dream';
import type { OracleCitation } from '../oracle.types';
import type { OracleGrounding } from './oracleGrounding.service';
import { escapeGroundingXml, compactGroundingText } from './oracleGroundingText.service';

const PERSONAL_HISTORY_LIMIT = 20;

// Detects explicit requests to recall, search, compare, or inspect the owner's saved dreams.
export function requestsPersonalDreamHistory(value: string): boolean {
  const normalized = String(value || '').normalize('NFKC').toLocaleLowerCase('vi');
  const mentionsDream = /(giấc mơ|bài mơ|dreams?|dream posts?)/iu.test(normalized);
  if (!mentionsDream) return false;

  return /(của tôi|tôi đã (?:lưu|đăng|kể)|trước (?:đây|đó)|cũ|lịch sử|đã lưu|my|mine|saved|previous|older|history)/iu
    .test(normalized)
    || /(truy cập|xem lại|đọc lại|nhớ lại|tìm lại|tìm|so sánh|tổng hợp|access|recall|remember|find|search|compare|summari[sz]e)/iu
      .test(normalized);
}

// Loads only the authenticated owner's records and exposes a bounded recent window to Oracle.
export async function buildOraclePersonalHistoryGrounding(
  userId: string,
): Promise<OracleGrounding> {
  const [total, dreams] = await Promise.all([
    Dream.countDocuments({ userId }),
    Dream.find({ userId })
      .select('_id content privacy created_at ai_status ai_result.title ai_result.summary')
      .sort({ created_at: -1, _id: -1 })
      .limit(PERSONAL_HISTORY_LIMIT)
      .lean(),
  ]);

  const citations: OracleCitation[] = dreams.map((dream, offset) => {
    const analysis = dream.ai_result as { title?: unknown; summary?: unknown } | null;
    const title = String(analysis?.title || '').trim();
    const summary = String(analysis?.summary || '').trim();
    return {
      index: offset + 1,
      sourceType: 'own_dream',
      sourceId: String(dream._id),
      title: compactGroundingText(title || 'Saved dream', 500),
      excerpt: compactGroundingText(dream.content, 1_200),
      detail: compactGroundingText([
        `Saved at: ${new Date(dream.created_at).toISOString()}`,
        `Visibility: ${dream.privacy || 'private'}`,
        `Analysis status: ${dream.ai_status || 'unknown'}`,
        summary ? `Prior analysis: ${summary}` : '',
      ].filter(Boolean).join(' · '), 900),
    };
  });

  return {
    citations,
    verificationQuestions: [],
    promptContext: buildPersonalHistoryPrompt(citations, total),
  };
}

// Tells the model exactly what owner-authorized history was retrieved for this turn.
function buildPersonalHistoryPrompt(citations: OracleCitation[], total: number): string {
  const visibleCount = citations.length;
  return [
    'OWNER_AUTHORIZED_DREAM_HISTORY',
    `The backend found ${total} saved dream record(s) owned by the authenticated user.`,
    `The ${visibleCount} most recent record(s) are included below, newest first.`,
    'These records were retrieved from DreamScape for this request. Do not claim that you cannot access the user’s saved dreams or that you can only see the current conversation.',
    total > visibleCount
      ? `This is a bounded recent window, not the full history. Say so if the user asks for all ${total} records, and ask how they want to narrow the search.`
      : 'The retrieved window contains all currently saved dream records for this user.',
    'Answer capability questions from the actual count above. When naming, summarizing, or comparing a record, add its exact [n] marker.',
    'Treat saved dreams as the user’s personal history, not as scientific evidence. Never expose another user’s private data.',
    ...citations.map((citation) => [
      `<untrusted_retrieved_content ref="[${citation.index}]" type="own_dream" id="${escapeGroundingXml(citation.sourceId)}">`,
      `<title>${escapeGroundingXml(citation.title)}</title>`,
      `<excerpt>${escapeGroundingXml(citation.excerpt)}</excerpt>`,
      citation.detail ? `<detail>${escapeGroundingXml(citation.detail)}</detail>` : '',
      '</untrusted_retrieved_content>',
    ].join('')),
  ].join('\n');
}
