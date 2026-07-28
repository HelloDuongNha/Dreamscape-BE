import { Types } from 'mongoose';
import OracleEvidenceGap from '../../models/OracleEvidenceGap';
import OracleThread from '../../models/OracleThread';
import OracleTurn from '../../models/OracleTurn';
import Dream from '../../../dream/models/Dream';

// Removes occurrences whose chat or dream no longer exists.
export async function pruneOrphanedEvidenceOccurrences(): Promise<void> {
  const gaps = await OracleEvidenceGap.find({});
  if (!gaps.length) return;
  const turnIds = [...new Set(gaps.flatMap((gap) => [
    String(gap.turnId || ''),
    ...(gap.occurrenceTurnIds || []).map(String),
  ]).filter(Boolean))];
  const dreamIds = [...new Set(gaps.flatMap((gap) =>
    (gap.occurrenceDreamIds || []).map(String)).filter(Boolean))];
  const [turns, dreams] = await Promise.all([
    OracleTurn.find({ _id: { $in: turnIds } }).select('_id threadId').lean(),
    Dream.find({ _id: { $in: dreamIds } }).select('_id').lean(),
  ]);
  const activeThreadIds = new Set((await OracleThread.find({
    _id: { $in: turns.map((turn) => turn.threadId) },
    deletedAt: { $exists: false },
  }).select('_id').lean()).map((thread) => String(thread._id)));
  const liveTurnIds = new Set(turns
    .filter((turn) => activeThreadIds.has(String(turn.threadId)))
    .map((turn) => String(turn._id)));
  const liveDreamIds = new Set(dreams.map((dream) => String(dream._id)));

  for (const gap of gaps) {
    const occurrenceTurnIds = [...new Set([
      String(gap.turnId || ''),
      ...(gap.occurrenceTurnIds || []).map(String),
    ].filter((id) => id && liveTurnIds.has(id)))];
    const occurrenceDreamIds = [...new Set(
      (gap.occurrenceDreamIds || []).map(String).filter((id) => liveDreamIds.has(id)),
    )];
    if (!occurrenceTurnIds.length && !occurrenceDreamIds.length) {
      await OracleEvidenceGap.deleteOne({ _id: gap._id });
      continue;
    }
    gap.occurrenceTurnIds = occurrenceTurnIds.map((id) => new Types.ObjectId(id));
    gap.occurrenceDreamIds = occurrenceDreamIds.map((id) => new Types.ObjectId(id));
    gap.occurrenceCount = occurrenceTurnIds.length + occurrenceDreamIds.length;
    if (!gap.turnId || !liveTurnIds.has(String(gap.turnId))) {
      const primaryTurn = turns.find(
        (turn) => String(turn._id) === occurrenceTurnIds[0],
      );
      gap.turnId = primaryTurn?._id;
      gap.threadId = primaryTurn?.threadId;
    }
    await gap.save();
  }
}

export async function removeEvidenceOccurrences(input: {
  turnIds?: Array<Types.ObjectId | string>;
  dreamIds?: Array<Types.ObjectId | string>;
}): Promise<void> {
  const removedTurnIds = new Set((input.turnIds || []).map(String));
  const removedDreamIds = new Set((input.dreamIds || []).map(String));
  if (!removedTurnIds.size && !removedDreamIds.size) return;

  const gaps = await OracleEvidenceGap.find({
    $or: [
      ...(removedTurnIds.size
        ? [{ occurrenceTurnIds: { $in: [...removedTurnIds] } }, { turnId: { $in: [...removedTurnIds] } }]
        : []),
      ...(removedDreamIds.size
        ? [{ occurrenceDreamIds: { $in: [...removedDreamIds] } }]
        : []),
    ],
  });

  for (const gap of gaps) {
    const turnIds = (gap.occurrenceTurnIds || [])
      .filter((id) => !removedTurnIds.has(String(id)));
    const dreamIds = (gap.occurrenceDreamIds || [])
      .filter((id) => !removedDreamIds.has(String(id)));
    if (!turnIds.length && !dreamIds.length) {
      await OracleEvidenceGap.deleteOne({ _id: gap._id });
      continue;
    }

    gap.occurrenceTurnIds = turnIds;
    gap.occurrenceDreamIds = dreamIds;
    gap.occurrenceCount = turnIds.length + dreamIds.length;
    if (!gap.turnId || removedTurnIds.has(String(gap.turnId))) {
      const primaryTurn = turnIds[0]
        ? await OracleTurn.findById(turnIds[0]).select('_id threadId').lean()
        : null;
      gap.turnId = primaryTurn?._id;
      gap.threadId = primaryTurn?.threadId;
    }
    await gap.save();
  }
}
