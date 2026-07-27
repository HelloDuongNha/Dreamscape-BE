import type { ModerationSourceQuery } from '../../dto/sourceContribution.dto';
import SourceContribution from '../../models/SourceContribution';
import { mapSourceOriginAndUrls } from '../source/academicSourceResponse.service';
import { repairContributionReaderStats } from './contributionReaderStats.service';

export async function listModerationSources(query: ModerationSourceQuery) {
  const filter = { reviewStatus: query.status };
  const skip = (query.page - 1) * query.limit;
  const total = await SourceContribution.countDocuments(filter);
  const sources = await SourceContribution.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(query.limit)
    .populate('submittedBy', 'username display_name email avatar');

  for (const source of sources) {
    try {
      await repairContributionReaderStats(source);
    } catch (error) {
      console.warn(
        `[Self-healing] Failed to dynamically compute stats in list for contribution ${source._id}:`,
        error,
      );
    }
  }

  return {
    sources: sources.map(mapSourceOriginAndUrls),
    pagination: {
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.ceil(total / query.limit),
    },
  };
}

export type UpdateContributionTitleResult =
  | { status: 200; data: { title: string } }
  | { status: 404 | 409; message: string };

export async function updatePendingContributionTitle(
  id: string,
  title: string,
): Promise<UpdateContributionTitleResult> {
  const contribution = await SourceContribution.findById(id);
  if (!contribution) {
    return { status: 404, message: 'Source contribution not found.' };
  }
  if (contribution.reviewStatus !== 'pending') {
    return {
      status: 409,
      message: 'Only a pending contribution title can be updated here.',
    };
  }

  contribution.title = title;
  contribution.metadata = { ...(contribution.metadata || {}), title };
  await contribution.save();
  return { status: 200, data: { title: contribution.title } };
}
