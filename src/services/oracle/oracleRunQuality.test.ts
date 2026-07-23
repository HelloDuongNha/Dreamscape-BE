import assert from 'node:assert/strict';
import test from 'node:test';
import {
  directAnswerSuggestions,
  validateAcademicCitationSupport,
} from './oracleRun.service';
import { buildOracleEvidenceGapResearchBrief } from './oracleEvidenceGap.service';

test('direct yes/no questions receive short reply affordances', () => {
  const suggestions = directAnswerSuggestions(
    'Bạn có cảm thấy hình ảnh cây cầu gợi ra một ý tưởng cụ thể không?',
  );
  assert.deepEqual(suggestions, [
    'Có, điều đó đúng với tôi.',
    'Không, tôi không thấy như vậy.',
    'Tôi chưa chắc.',
  ]);
  assert.equal(
    directAnswerSuggestions('Bạn muốn giải thích ý tưởng đó như thế nào?').length,
    0,
  );
});

test('an academic citation cannot cover concepts absent from its evidence scope', () => {
  const answer = 'Giấc mơ cho thấy áp lực công việc và nhiệm vụ tương lai được xử lý qua ký ức [1].';
  const citations = [{
    index: 1,
    sourceType: 'academic_source' as const,
    sourceId: 'source-1',
    title: 'A broad memory paper',
    excerpt: 'Memory is a major element of dreams.',
    detail: 'Supported claim: Memory is a major element of dreams.',
  }];
  assert.equal(
    validateAcademicCitationSupport(answer, citations),
    'Giấc mơ cho thấy áp lực công việc và nhiệm vụ tương lai được xử lý qua ký ức [?].',
  );
});

test('a substantive quote remains when it covers the adjacent claim scope', () => {
  const answer = 'Giấc mơ có thể kết hợp ký ức quá khứ với một sự kiện dự kiến trong tương lai [1].';
  const citations = [{
    index: 1,
    sourceType: 'academic_source' as const,
    sourceId: 'source-1',
    title: 'Constructive episodic simulation in dreams',
    excerpt: 'Participants identified dreams as related to both specific past memories and anticipated future events.',
    detail: 'Supported claim: Dreams can relate to both past events and anticipated future events.',
  }];
  assert.equal(validateAcademicCitationSupport(answer, citations), answer);
});

test('Deep Research brief uses academic database queries instead of isolated words', () => {
  const brief = buildOracleEvidenceGapResearchBrief(
    'Khi lo lắng được chuyển thành hành động cụ thể, áp lực tâm lý có thể giảm [?].',
  );
  assert.ok(brief.searchTerms.every((query) => query.includes(' ')));
  assert.match(brief.deepResearchPrompt, /Crossref/u);
  assert.match(brief.deepResearchPrompt, /doi\.org/u);
  assert.match(brief.deepResearchPrompt, /Unpaywall/u);
});
