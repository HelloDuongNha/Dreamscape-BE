import mongoose from 'mongoose';
import Dream from '../../../models/Dream';
import User from '../../../../identity/models/User';
import Comment from '../../../../social/models/Comment';
import { generateEmbedding } from '../../../../../infrastructure/llm.service';

export interface SimilarDreamMatch {
  dreamId: string;
  title: string;
  excerpt: string;
  createdAt: string;
  authorDisplayName: string;
  sameAuthor: boolean;
  similarity: number;
  duplicateCount?: number;
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

function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return -1;
  let dot = 0; let aa = 0; let bb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : -1;
}

export function scoreDreamSimilarity(input: {
  exact: boolean;
  semantic: number;
  lexicalOverlap: number;
}): number {
  if (input.exact) return 1;
  return input.semantic >= 0
    ? Math.max(0, input.semantic) * 0.85 + input.lexicalOverlap * 0.15
    : input.lexicalOverlap;
}

function compact(value: string, max = 260): string {
  const clean = String(value || '').replace(/\s+/gu, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function isSameAuthor(row: any, userId: string): boolean {
  const author = row?.userId;
  return String(author?._id || author) === userId;
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
  const rankedPrelim = rows.map(row => {
    const exact = normalize(row.content) === queryNormalized;
    const lexical = overlap(queryTokens, tokens(row.content));
    return { row, exact, lexical, preliminary: exact ? 1 : lexical };
  }).sort((a, b) => b.preliminary - a.preliminary);

  // Collapse repeated narratives before ranking so one story cannot fill the result window.
  const groupedPrelim = new Map<string, (typeof rankedPrelim)[number] & { duplicateCount: number }>();
  for (const item of rankedPrelim) {
    // Keep personal and public copies separate so their provenance remains clear.
    const narrativeKey = `${isSameAuthor(item.row, userId) ? 'own' : 'public'}:${normalize(item.row.content)}`;
    const existing = groupedPrelim.get(narrativeKey);
    if (existing) {
      existing.duplicateCount += 1;
      continue;
    }
    groupedPrelim.set(narrativeKey, { ...item, duplicateCount: 1 });
  }
  const prelim = [...groupedPrelim.values()].slice(0, 16);

  // Embed only the strongest legacy candidates and reuse those vectors later.
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
      lexicalOverlap: item.lexical,
    });
    return { ...item, semantic, score };
  }).filter(item => item.exact || item.score >= 0.4)
    .sort((a, b) => b.score - a.score
      || Number(isSameAuthor(b.row, userId)) - Number(isSameAuthor(a.row, userId)))
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
        sameAuthor: isSameAuthor(item.row, userId),
        similarity: Math.round(Math.min(1, item.score) * 100),
        duplicateCount: item.duplicateCount,
        priorAnalysisSummary: compact(item.row.ai_result?.summary || '', 320) || undefined,
        ...(confirmedContext.length ? { confirmedContext } : {}),
        ...(ownerContextComments.length ? { ownerContextComments } : {}),
      };
    });

  return { queryEmbedding, matches };
}
