import { Types } from 'mongoose';
import Dream from '../../models/Dream';

export type DreamAccessDecision = {
  canView: boolean;
  canInteract: boolean;
  isOwner: boolean;
  reason: 'owner' | 'public' | 'private';
};

/**
 * One privacy decision for detail, comments, notifications and search. A legacy
 * record is public only when `is_public` is true and `privacy` is not explicitly
 * private; conflicting fields therefore fail closed for non-owners.
 */
export function decideDreamAccess(
  dream: {
    userId: unknown;
    is_public?: boolean;
    privacy?: string;
  },
  viewerId?: string,
): DreamAccessDecision {
  const ownerId = String((dream.userId as any)?._id ?? dream.userId ?? '');
  const isOwner = Boolean(viewerId && ownerId === viewerId);
  if (isOwner) {
    return { canView: true, canInteract: true, isOwner: true, reason: 'owner' };
  }
  const isPublic = dream.is_public === true && dream.privacy !== 'private';
  return {
    canView: isPublic,
    canInteract: isPublic,
    isOwner: false,
    reason: isPublic ? 'public' : 'private',
  };
}

export function buildDreamVisibilityFilter(viewerId?: string): Record<string, unknown> {
  const publicClause = {
    is_public: true,
    privacy: { $ne: 'private' },
  };
  if (!viewerId || !Types.ObjectId.isValid(viewerId)) return publicClause;
  return {
    $or: [
      { userId: new Types.ObjectId(viewerId) },
      publicClause,
    ],
  };
}

export async function findAccessibleDream(
  dreamId: string,
  viewerId?: string,
) {
  if (!Types.ObjectId.isValid(dreamId)) return null;
  return Dream.findOne({
    _id: new Types.ObjectId(dreamId),
    ...buildDreamVisibilityFilter(viewerId),
  });
}
