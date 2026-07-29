import { Types } from 'mongoose';
import OracleRun from '../../models/OracleRun';
import OracleRunEvent, { OracleRunEventType } from '../../models/OracleRunEvent';

export async function appendOracleRunEvent(
  runId: Types.ObjectId,
  threadId: Types.ObjectId,
  userId: Types.ObjectId,
  eventType: OracleRunEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  const run = await OracleRun.findOneAndUpdate(
    { _id: runId, threadId, userId },
    { $inc: { lastEventSequence: 1 } },
    { new: true },
  );
  if (!run) return;
  await OracleRunEvent.create({
    runId,
    threadId,
    userId,
    sequence: run.lastEventSequence,
    eventType,
    payload,
  });
}
