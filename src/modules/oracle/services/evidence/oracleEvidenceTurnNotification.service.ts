import { Types } from 'mongoose';
import { getSocketServer } from '../../../../config/socket';
import OracleTurn from '../../models/OracleTurn';

export const ORACLE_CITATION_STATE_CHANGED = 'oracle_citation_state_changed';

// Notifies each owner once after persisted Oracle citations have changed.
export async function emitOracleCitationStatesChanged(
  turnIds: Array<string | Types.ObjectId>,
): Promise<void> {
  const io = getSocketServer();
  const ids = [...new Set(turnIds.map(String).filter(Types.ObjectId.isValid))]
    .map(id => new Types.ObjectId(id));
  if (!io || !ids.length) return;

  const turns = await OracleTurn.find({ _id: { $in: ids } })
    .select('_id userId threadId')
    .lean();
  const changesByUser = new Map<string, { turnIds: string[]; threadIds: string[] }>();
  for (const turn of turns) {
    const userId = String(turn.userId || '');
    if (!userId) continue;
    const change = changesByUser.get(userId) || { turnIds: [], threadIds: [] };
    const turnId = String(turn._id);
    const threadId = String(turn.threadId);
    if (!change.turnIds.includes(turnId)) change.turnIds.push(turnId);
    if (!change.threadIds.includes(threadId)) change.threadIds.push(threadId);
    changesByUser.set(userId, change);
  }

  const changedAt = new Date().toISOString();
  for (const [userId, change] of changesByUser) {
    io.to(userId).emit(ORACLE_CITATION_STATE_CHANGED, { ...change, changedAt });
  }
}
