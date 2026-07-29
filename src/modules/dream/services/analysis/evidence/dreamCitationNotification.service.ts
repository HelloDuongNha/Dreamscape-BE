import { Types } from 'mongoose';
import { getSocketServer } from '../../../../../config/socket';
import Dream from '../../../models/Dream';

export const DREAM_CITATION_STATE_CHANGED = 'dream_citation_state_changed';

// Notifies each Dream owner after its persisted citation lifecycle changes.
export function emitDreamCitationStateChanged(dream: any): void {
  const io = getSocketServer();
  const dreamId = String(dream?._id || '');
  const userId = String(dream?.userId?._id || dream?.userId || '');
  if (!io || !dreamId || !userId) return;
  io.to(userId).emit(DREAM_CITATION_STATE_CHANGED, {
    dreamIds: [dreamId],
    changedAt: new Date().toISOString(),
  });
}

// Groups invalidated Dreams by owner so one source deletion emits one compact update.
export async function emitDreamCitationStatesChanged(
  dreamIds: Array<string | Types.ObjectId>,
): Promise<void> {
  const io = getSocketServer();
  const ids = [...new Set(dreamIds.map(String).filter(Types.ObjectId.isValid))]
    .map(id => new Types.ObjectId(id));
  if (!io || !ids.length) return;
  const dreams = await Dream.find({ _id: { $in: ids } }).select('_id userId').lean();
  const byUser = new Map<string, string[]>();
  for (const dream of dreams) {
    const userId = String(dream.userId || '');
    if (!userId) continue;
    byUser.set(userId, [...(byUser.get(userId) || []), String(dream._id)]);
  }
  const changedAt = new Date().toISOString();
  for (const [userId, ownerDreamIds] of byUser) {
    io.to(userId).emit(DREAM_CITATION_STATE_CHANGED, {
      dreamIds: ownerDreamIds,
      changedAt,
    });
  }
}
