import mongoose from 'mongoose';
import Dream from '../../models/Dream';
import User from '../../models/User';
import Comment from '../../models/Comment';
import { generateEmbedding } from '../infrastructure/llm.service';

export interface SimilarDreamMatch {
  dreamId: string;
  title: string;
  excerpt: string;
  createdAt: string;
  authorDisplayName: string;
  sameAuthor: boolean;
  similarity: number;
  matchedOn: string[];
  priorAnalysisSummary?: string;
  confirmedContext?: Array<{
    question: string;
    answer: 'yes' | 'no';
    interpretation: string;
  }>;
  ownerContextComments?: string[];
}

export interface SimilarDreamRetrievalResult {
  queryEmbedding: number[];
  matches: SimilarDreamMatch[];
}

function normalize(value: string): string {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('vi').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function tokens(value: string): Set<string> {
  return new Set(normalize(value).split(/\s+/u).filter(token => token.length >= 3));
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

export function dreamLexicalOverlap(a: string, b: string): number {
  return overlap(tokens(a), tokens(b));
}

const FEATURE_PATTERNS: Array<[string, RegExp]> = [
  ['ký ức hoặc sợ quên', /(?:quên|nhớ|ký\s*ức|trí\s*nhớ|sổ\s*trắng|forget|memory|blank\s+(?:book|page))/iu],
  ['trường học hoặc đánh giá', /(?:trường|lớp|thi|kiểm\s*tra|thuyết\s*trình|school|class|exam|presentation)/iu],
  ['người thân và tuổi thơ', /(?:bà\s*(?:ngoại|nội)?|ông\s*(?:ngoại|nội)?|cha|mẹ|gia\s*đình|tuổi\s*thơ|grandmother|grandfather|family|childhood)/iu],
  ['bị đuổi hoặc chạy trốn', /(?:đuổi|chạy\s*trốn|bắt\s*kịp|pursu|chase|running\s+away)/iu],
  ['nước hoặc ngập', /(?:nước|ngập|sông|biển|water|flood|river|sea)/iu],
  ['cầu, cửa hoặc chuyển tiếp', /(?:cầu|cánh\s*cửa|ngưỡng|chuyển\s*tiếp|bridge|door|threshold|transition)/iu],
  ['nhà hoặc nơi chốn cũ', /(?:nhà\s*cũ|trường\s*cũ|nơi\s*cũ|old\s+(?:house|home|school)|former\s+home)/iu],
  ['áp lực hoặc lo âu', /(?:áp\s*lực|lo\s*âu|lo\s*lắng|căng\s*thẳng|sợ|pressure|anxiety|stress|fear)/iu],
  ['mất mát hoặc tiếc nuối', /(?:mất|tiếc\s*nuối|đóng\s*lại|loss|regret|grief|closed)/iu],
];

export function extractDreamSimilarityFeatures(value: string): Set<string> {
  const result = new Set<string>();
  for (const [label, pattern] of FEATURE_PATTERNS) if (pattern.test(value)) result.add(label);
  return result;
}

function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return -1;
  let dot = 0; let aa = 0; let bb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : -1;
}

function featureOverlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

export function scoreDreamSimilarity(input: {
  exact: boolean;
  semantic: number;
  motifOverlap: number;
  lexicalOverlap: number;
}): number {
  if (input.exact) return 1;
  return input.semantic >= 0
    ? Math.max(0, input.semantic) * 0.6 + input.motifOverlap * 0.3 + input.lexicalOverlap * 0.1
    : input.motifOverlap * 0.75 + input.lexicalOverlap * 0.25;
}

function compact(value: string, max = 260): string {
  const clean = String(value || '').replace(/\s+/gu, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export async function retrieveSimilarDreams(
  userId: string,
  dreamText: string,
  limit = 4,
): Promise<SimilarDreamRetrievalResult> {
  let queryEmbedding: number[] = [];
  try { queryEmbedding = await generateEmbedding(dreamText); } catch { queryEmbedding = []; }

  const userObjectId = new mongoose.Types.ObjectId(userId);
  const rows: any[] = await Dream.find({
    ai_status: 'completed',
    $or: [{ userId: userObjectId }, { privacy: 'public', is_public: true }],
  })
    .select('+analysisEmbedding content userId created_at ai_result.title ai_result.summary ai_result.emotional_tone ai_result.real_life_hypotheses realLifeHypothesesFeedback')
    .populate({ path: 'userId', model: User, select: 'display_name username' })
    .sort({ created_at: -1 })
    .limit(100)
    .lean();

  const queryNormalized = normalize(dreamText);
  const queryTokens = tokens(dreamText);
  const queryFeatures = extractDreamSimilarityFeatures(dreamText);
  const prelim = rows.map(row => {
    const exact = normalize(row.content) === queryNormalized;
    const lexical = overlap(queryTokens, tokens(row.content));
    const motifs = featureOverlap(queryFeatures, extractDreamSimilarityFeatures(row.content));
    return { row, exact, lexical, motifs, preliminary: exact ? 1 : motifs * 0.7 + lexical * 0.3 };
  }).sort((a, b) => b.preliminary - a.preliminary).slice(0, 16);

  // Lazy migration: only embed the strongest old candidates. Future analyses
  // reuse these vectors, so semantic matching does not repeatedly grow slower.
  for (const item of prelim.slice(0, 8)) {
    if (Array.isArray(item.row.analysisEmbedding) && item.row.analysisEmbedding.length) continue;
    try {
      const embedding = await generateEmbedding(item.row.content);
      item.row.analysisEmbedding = embedding;
      await Dream.updateOne({ _id: item.row._id }, { $set: { analysisEmbedding: embedding } });
    } catch {
      item.row.analysisEmbedding = [];
    }
  }

  const selected = prelim.map(item => {
    const semantic = cosine(queryEmbedding, item.row.analysisEmbedding || []);
    const score = scoreDreamSimilarity({
      exact: item.exact,
      semantic,
      motifOverlap: item.motifs,
      lexicalOverlap: item.lexical,
    });
    const matchedOn: string[] = [];
    if (item.exact) matchedOn.push('Cùng nội dung');
    if (semantic >= 0.65) matchedOn.push('Cùng mạch ngữ nghĩa');
    if (item.motifs >= 0.5) matchedOn.push('Cùng tình tiết hoặc mô-típ');
    if (item.lexical >= 0.35) matchedOn.push('Nhiều chi tiết tương đồng');
    return { ...item, semantic, score, matchedOn };
  }).filter(item => item.exact || (item.score >= 0.4 && (item.motifs >= 0.25 || item.lexical >= 0.18)))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const selectedDreamIds = selected.map(item => item.row._id);
  const ownerComments = selectedDreamIds.length > 0
    ? await Comment.find({ dreamId: { $in: selectedDreamIds } }).sort({ created_at: 1 }).lean()
    : [];

  const matches = selected.map(item => {
      const author: any = item.row.userId;
      const ownerId = String(author?._id || author);
      const hypotheses = Array.isArray(item.row.ai_result?.real_life_hypotheses)
        ? item.row.ai_result.real_life_hypotheses : [];
      const confirmedContext = (item.row.realLifeHypothesesFeedback || [])
        .filter((feedback: any) => feedback.answer === 'yes' || feedback.answer === 'no')
        .slice(0, 4)
        .map((feedback: any) => {
          const hypothesis = hypotheses[feedback.hypothesisIndex] || {};
          return {
            question: String(feedback.questionText || hypothesis.followUpQuestion || '').trim(),
            answer: feedback.answer as 'yes' | 'no',
            interpretation: String(feedback.answer === 'yes' ? hypothesis.ifYesMeaning : hypothesis.ifNoMeaning).trim(),
          };
        })
        .filter((feedback: any) => feedback.question);
      const ownerContextComments = ownerComments
        .filter((comment: any) => String(comment.dreamId) === String(item.row._id) && String(comment.userId) === ownerId)
        .map((comment: any) => compact(comment.content, 240))
        .filter(Boolean)
        .slice(0, 3);
      return {
        dreamId: String(item.row._id),
        title: item.row.ai_result?.title || 'Giấc mơ tương tự',
        excerpt: compact(item.row.content),
        createdAt: new Date(item.row.created_at).toISOString(),
        authorDisplayName: author?.display_name || author?.username || 'Người dùng DreamScape',
        sameAuthor: String(author?._id || author) === userId,
        similarity: Math.round(Math.min(1, item.score) * 100),
        matchedOn: item.matchedOn,
        priorAnalysisSummary: compact(item.row.ai_result?.summary || '', 320) || undefined,
        ...(confirmedContext.length ? { confirmedContext } : {}),
        ...(ownerContextComments.length ? { ownerContextComments } : {}),
      };
    });

  return { queryEmbedding, matches };
}
