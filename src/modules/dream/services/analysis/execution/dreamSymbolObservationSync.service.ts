import { Types } from 'mongoose';
import { logger } from '../../../../../infrastructure/logger';
import { materializeDreamSymbolObservations } from '../retrieval/symbolObservation.service';

// Refresh the secondary symbol index without invalidating a saved analysis.
export async function syncDreamSymbolObservations(dream: any): Promise<void> {
  try {
    await materializeDreamSymbolObservations({
      dreamId: new Types.ObjectId(String(dream._id)),
      userId: new Types.ObjectId(String(dream.userId)),
      isPublic: dream.privacy === 'public' || dream.is_public === true,
      symbolicNotes: Array.isArray(dream.ai_result?.symbolic_notes)
        ? dream.ai_result.symbolic_notes
        : [],
    });
  } catch (error) {
    logger.warn('Could not refresh dream symbol observations.', {
      dreamId: String(dream?._id || ''),
      error: String(error),
    });
  }
}
