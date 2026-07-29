import { Types } from 'mongoose';
import OracleTurn from '../../models/OracleTurn';

export interface OracleConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function loadOracleConversation(
  threadId: Types.ObjectId,
  userId: Types.ObjectId,
  leafTurnId: Types.ObjectId,
): Promise<OracleConversationMessage[]> {
  const turns = await OracleTurn.find({
    threadId,
    userId,
    status: 'completed',
    role: { $in: ['user', 'assistant'] },
  })
    .sort({ sequence: -1 })
    .limit(100)
    .lean();
  const byId = new Map(turns.map((turn) => [String(turn._id), turn]));
  const ancestry: typeof turns = [];
  let current = byId.get(String(leafTurnId));
  while (current && ancestry.length < 80) {
    ancestry.push(current);
    current = current.parentTurnId ? byId.get(String(current.parentTurnId)) : undefined;
  }
  const selectedTurns = ancestry.length > 1
    ? ancestry.reverse().slice(-80)
    : turns.reverse()
      .filter((turn) => turn.sequence <= (ancestry[0]?.sequence || Number.MAX_SAFE_INTEGER))
      .slice(-80);
  return selectedTurns
    .map((turn) => ({
      role: turn.role as 'user' | 'assistant',
      content: turn.contentBlocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n'),
    }))
    .filter((message) => message.content.trim());
}
