import { Types } from 'mongoose';
import User from '../../../identity/models/User';
import Comment from '../../../social/models/Comment';
import Dream from '../../models/Dream';
import type {
  DreamMoodLevel,
  DreamSearchRequestDto,
} from '../../dto/dreamSearch.dto';
import { buildDreamVisibilityFilter } from './dreamAccessPolicy.service';
import { mapDreamResponse } from './dreamNarrative.service';

export interface SearchTextRange {
  start: number;
  end: number;
}

export interface DreamSearchCommentMatch {
  _id: string;
  content: string;
  created_at: Date;
  user: {
    _id: string;
    username: string;
    display_name: string;
    avatar: string;
  } | null;
  ranges: SearchTextRange[];
}

export interface DreamSearchItem {
  dream: unknown;
  dreamRanges: SearchTextRange[];
  matchedComments: DreamSearchCommentMatch[];
  matchedCommentCount: number;
}

export interface DreamSearchPage {
  data: DreamSearchItem[];
  limit: number;
  nextCursor: string | null;
}

type AggregatedCommentGroup = {
  _id: Types.ObjectId;
  matchedCommentCount: number;
  comments: Array<{
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    content: string;
    created_at: Date;
  }>;
};

const AUTHOR_PROJECTION = 'username display_name avatar';
const COMMENT_MATCH_LIMIT = 3;

/**
 * Search is deliberately a read pipeline: normalize/validate in the DTO,
 * retrieve only visible Dream IDs, then hydrate text and authors. Comment
 * matches never become a side channel because Dream visibility is applied
 * inside the lookup before a comment can enter the result set.
 */
export async function searchAccessibleDreams(
  request: DreamSearchRequestDto,
  viewerId?: string,
): Promise<DreamSearchPage> {
  const baseFilter = buildSearchableDreamFilter(request, viewerId);
  const matcher = request.query ? createLiteralMatcher(request.query) : null;

  const { candidateIds, commentGroups } = matcher
    ? await retrieveTextMatchCandidates(baseFilter, request, viewerId, matcher.database)
    : { candidateIds: null, commentGroups: [] };

  if (candidateIds && candidateIds.length === 0) {
    return { data: [], limit: request.limit, nextCursor: null };
  }

  const dreams = await retrieveResultDreams(baseFilter, candidateIds, request.limit + 1);
  const hasMore = dreams.length > request.limit;
  const pageDreams = hasMore ? dreams.slice(0, request.limit) : dreams;
  const commentsByDream = await presentCommentMatches(commentGroups, matcher?.ranges ?? null);

  return {
    data: pageDreams.map(dream => {
      const id = String(dream._id);
      const commentMatch = commentsByDream.get(id);
      return {
        dream: mapDreamResponse(dream),
        dreamRanges: matcher ? matcher.ranges(String(dream.content ?? '')) : [],
        matchedComments: commentMatch?.comments ?? [],
        matchedCommentCount: commentMatch?.count ?? 0,
      };
    }),
    limit: request.limit,
    nextCursor: hasMore
      ? pageDreams[pageDreams.length - 1]?.created_at.toISOString() ?? null
      : null,
  };
}

export function findLiteralSearchRanges(text: string, query: string): SearchTextRange[] {
  if (!text || !query.trim()) return [];
  const matcher = new RegExp(buildLiteralPattern(query), 'giu');
  const ranges: SearchTextRange[] = [];
  for (const match of text.matchAll(matcher)) {
    if (match.index === undefined || !match[0]) continue;
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

function buildSearchableDreamFilter(
  request: DreamSearchRequestDto,
  viewerId?: string,
): Record<string, unknown> {
  const clauses: Record<string, unknown>[] = [buildDreamVisibilityFilter(viewerId)];
  if (request.mood) clauses.push(buildMoodFilter(request.mood));
  if (request.cursor) clauses.push({ created_at: { $lt: request.cursor } });
  return clauses.length === 1 ? clauses[0] : { $and: clauses };
}

function buildMoodFilter(level: DreamMoodLevel, prefix = ''): Record<string, unknown> {
  const valenceField = `${prefix}ai_result.emotional_valence`;
  const toneField = `${prefix}ai_result.emotional_tone_key`;
  const { valence, legacyTones } = MOOD_FILTERS[level];
  return {
    $or: [
      { [valenceField]: valence },
      {
        $and: [
          {
            $or: [
              { [valenceField]: { $exists: false } },
              { [valenceField]: null },
            ],
          },
          { [toneField]: { $in: legacyTones } },
        ],
      },
    ],
  };
}

async function retrieveTextMatchCandidates(
  baseFilter: Record<string, unknown>,
  request: DreamSearchRequestDto,
  viewerId: string | undefined,
  databaseMatcher: RegExp,
): Promise<{
  candidateIds: Types.ObjectId[];
  commentGroups: AggregatedCommentGroup[];
}> {
  const candidateLimit = request.limit * 4;
  const [dreamMatches, commentGroups] = await Promise.all([
    Dream.find({ $and: [baseFilter, { content: databaseMatcher }] })
      .select('_id')
      .sort({ created_at: -1 })
      .limit(candidateLimit)
      .lean(),
    retrieveCommentMatchGroups(request, viewerId, databaseMatcher, candidateLimit),
  ]);

  const ids = new Map<string, Types.ObjectId>();
  for (const dream of dreamMatches) ids.set(String(dream._id), dream._id);
  for (const group of commentGroups) ids.set(String(group._id), group._id);
  return { candidateIds: [...ids.values()], commentGroups };
}

async function retrieveCommentMatchGroups(
  request: DreamSearchRequestDto,
  viewerId: string | undefined,
  databaseMatcher: RegExp,
  candidateLimit: number,
): Promise<AggregatedCommentGroup[]> {
  const dreamClauses = buildJoinedDreamClauses(request, viewerId);
  return Comment.aggregate<AggregatedCommentGroup>([
    { $match: { is_deleted: false, content: databaseMatcher } },
    {
      $lookup: {
        from: Dream.collection.name,
        localField: 'dreamId',
        foreignField: '_id',
        as: 'dream',
      },
    },
    { $unwind: '$dream' },
    { $match: { $and: dreamClauses } },
    { $sort: { 'dream.created_at': -1, created_at: 1 } },
    {
      $group: {
        _id: '$dreamId',
        dreamCreatedAt: { $first: '$dream.created_at' },
        matchedCommentCount: { $sum: 1 },
        comments: {
          $push: {
            _id: '$_id',
            userId: '$userId',
            content: '$content',
            created_at: '$created_at',
          },
        },
      },
    },
    {
      $project: {
        dreamCreatedAt: 1,
        matchedCommentCount: 1,
        comments: { $slice: ['$comments', COMMENT_MATCH_LIMIT] },
      },
    },
    { $sort: { dreamCreatedAt: -1 } },
    { $limit: candidateLimit },
  ]);
}

function buildJoinedDreamClauses(
  request: DreamSearchRequestDto,
  viewerId?: string,
): Record<string, unknown>[] {
  const publicClause = {
    'dream.is_public': true,
    'dream.privacy': { $ne: 'private' },
  };
  const visibilityClause = viewerId && Types.ObjectId.isValid(viewerId)
    ? {
        $or: [
          { 'dream.userId': new Types.ObjectId(viewerId) },
          publicClause,
        ],
      }
    : publicClause;

  const clauses: Record<string, unknown>[] = [visibilityClause];
  if (request.mood) clauses.push(buildMoodFilter(request.mood, 'dream.'));
  if (request.cursor) clauses.push({ 'dream.created_at': { $lt: request.cursor } });
  return clauses;
}

async function retrieveResultDreams(
  baseFilter: Record<string, unknown>,
  candidateIds: Types.ObjectId[] | null,
  limit: number,
) {
  const filter = candidateIds
    ? { $and: [baseFilter, { _id: { $in: candidateIds } }] }
    : baseFilter;
  return Dream.find(filter)
    .sort({ created_at: -1 })
    .limit(limit)
    .populate('userId', AUTHOR_PROJECTION)
    .lean();
}

async function presentCommentMatches(
  groups: AggregatedCommentGroup[],
  rangeFinder: ((text: string) => SearchTextRange[]) | null,
): Promise<Map<string, { count: number; comments: DreamSearchCommentMatch[] }>> {
  if (!groups.length || !rangeFinder) return new Map();
  const userIds = [...new Set(
    groups.flatMap(group => group.comments.map(comment => String(comment.userId))),
  )];
  const users = await User.find({ _id: { $in: userIds } })
    .select(AUTHOR_PROJECTION)
    .lean();
  const usersById = new Map(users.map(user => [String(user._id), user]));

  return new Map(groups.map(group => [
    String(group._id),
    {
      count: group.matchedCommentCount,
      comments: group.comments.map(comment => {
        const user = usersById.get(String(comment.userId));
        return {
          _id: String(comment._id),
          content: comment.content,
          created_at: comment.created_at,
          user: user
            ? {
                _id: String(user._id),
                username: user.username,
                display_name: user.display_name,
                avatar: user.avatar,
              }
            : null,
          ranges: rangeFinder(comment.content),
        };
      }),
    },
  ]));
}

function createLiteralMatcher(query: string): {
  database: RegExp;
  ranges: (text: string) => SearchTextRange[];
} {
  const pattern = buildLiteralPattern(query);
  return {
    database: new RegExp(pattern, 'i'),
    ranges: text => findLiteralSearchRanges(text, query),
  };
}

function buildLiteralPattern(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .map(escapeRegExp)
    .join('\\s+');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const MOOD_FILTERS: Record<
  DreamMoodLevel,
  { valence: -2 | -1 | 0 | 1 | 2; legacyTones: string[] }
> = {
  'very-negative': { valence: -2, legacyTones: ['fearful', 'sad'] },
  negative: { valence: -1, legacyTones: ['anxious', 'urgent_conflicted'] },
  mixed: { valence: 0, legacyTones: ['mixed', 'neutral'] },
  positive: { valence: 1, legacyTones: ['calm'] },
  'very-positive': { valence: 2, legacyTones: [] },
};
