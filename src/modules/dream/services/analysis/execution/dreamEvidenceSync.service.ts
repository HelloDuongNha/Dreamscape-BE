import { Types } from 'mongoose';
import { logger } from '../../../../../infrastructure/logger';
import { collectDreamEvidenceRecord } from '../../../../../shared/evidence/dreamEvidenceRecord';
import { captureDreamEvidenceGaps } from '../../../../oracle/services/evidence/oracleEvidenceCapture.service';

// Synchronizes every unresolved claim from the Dream and its stored versions.
export async function syncDreamEvidenceNeeds(dream: any): Promise<void> {
  try {
    const evidenceRecord = collectDreamEvidenceRecord(dream);
    await captureDreamEvidenceGaps({
      userId: dream.userId as Types.ObjectId,
      dreamId: dream._id as Types.ObjectId,
      answer: evidenceRecord.answer,
      claimBindings: evidenceRecord.claimBindings,
    });
  } catch (error: unknown) {
    logger.warn(`Could not synchronize Evidence Needed for dream ${dream._id}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
