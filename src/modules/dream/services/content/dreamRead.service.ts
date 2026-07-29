import { Types } from 'mongoose';
import Dream from '../../models/Dream';
import type {
  DreamDetailRequestDto,
  DreamPaginationDto,
  UserDreamsRequestDto,
} from '../../dto/dreamRead.dto';
import { mapDreamResponse } from './dreamNarrative.service';
import { buildDreamVisibilityFilter } from './dreamAccessPolicy.service';

export interface DreamPage {
  data: unknown[];
  limit: number;
  nextCursor: string | null;
}

const AUTHOR_PROJECTION = 'username display_name avatar';

async function findDreamPage(
  filter: Record<string, unknown>,
  pagination: DreamPaginationDto,
): Promise<DreamPage> {
  const queryFilter = { ...filter };
  if (pagination.cursor) {
    queryFilter.created_at = { $lt: pagination.cursor };
  }

  const dreams = await Dream.find(queryFilter)
    .sort({ created_at: -1 })
    .limit(pagination.limit)
    .populate('userId', AUTHOR_PROJECTION)
    .lean();

  const nextCursor =
    dreams.length === pagination.limit
      ? dreams[dreams.length - 1].created_at.toISOString()
      : null;

  return {
    data: dreams.map(mapDreamResponse),
    limit: pagination.limit,
    nextCursor,
  };
}

export function getPublicDreamPage(pagination: DreamPaginationDto): Promise<DreamPage> {
  return findDreamPage(buildDreamVisibilityFilter(), pagination);
}

export function getUserDreamPage(
  request: UserDreamsRequestDto,
  viewerId?: string,
): Promise<DreamPage> {
  return findDreamPage(
    {
      userId: new Types.ObjectId(request.userId),
      ...buildDreamVisibilityFilter(viewerId),
    },
    request,
  );
}

export async function getDreamDetail(
  request: DreamDetailRequestDto,
  viewerId?: string,
): Promise<unknown | null> {
  const dream = await Dream.findOne({
    _id: new Types.ObjectId(request.dreamId),
    ...buildDreamVisibilityFilter(viewerId),
  }).populate('userId', AUTHOR_PROJECTION);
  return dream ? mapDreamResponse(dream) : null;
}
