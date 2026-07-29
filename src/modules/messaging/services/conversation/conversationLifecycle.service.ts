import { Types } from 'mongoose';
import User from '../../../identity/models/User';
import { ConversationSearchRequestDto } from '../../dto/conversation.dto';
import Conversation from '../../models/Conversation';
import Message from '../../models/Message';
import { searchMessaging } from '../search/messagingSearch.service';
import { ConversationRequestError } from './conversationRead.service';

export async function resolveConversationRequest(
  userId: Types.ObjectId,
  input: ConversationSearchRequestDto,
) {
  if (input.searchMode === 'messaging') {
    return searchAllMessaging(userId, input.query);
  }
  if (input.open && input.targetUserId) {
    return openOrCreateConversation(userId, input.targetUserId);
  }
  if (!input.username || input.username.trim() === '') {
    throw new ConversationRequestError(
      400,
      'username is required for search.',
    );
  }
  if (!input.open || !input.targetUserId) {
    return searchConversationUsers(userId, input.username);
  }
  throw new ConversationRequestError(400, 'Invalid request.');
}

export async function deleteParticipantConversation(
  conversationId: string,
  userId: Types.ObjectId,
): Promise<void> {
  if (!Types.ObjectId.isValid(conversationId)) {
    throw new ConversationRequestError(400, 'Invalid conversationId.');
  }

  const objectId = new Types.ObjectId(conversationId);
  const conversation = await Conversation.findOne({
    _id: objectId,
    participant_ids: userId,
  }).lean();
  if (!conversation) {
    throw new ConversationRequestError(
      403,
      'Access denied or conversation not found.',
    );
  }

  await Message.deleteMany({ conversationId: objectId });
  await Conversation.findByIdAndDelete(conversationId);
}

async function searchAllMessaging(
  userId: Types.ObjectId,
  query: string | undefined,
) {
  return {
    kind: 'search' as const,
    data: await searchMessaging(userId, String(query ?? '')),
  };
}

async function searchConversationUsers(
  userId: Types.ObjectId,
  username: string,
) {
  const scopedResults = await searchMessaging(userId, username);
  return {
    kind: 'search' as const,
    data: scopedResults.conversations.map((result) => result.user),
  };
}

async function openOrCreateConversation(
  userId: Types.ObjectId,
  targetUserId: string,
) {
  if (!Types.ObjectId.isValid(targetUserId)) {
    throw new ConversationRequestError(400, 'Invalid targetUserId.');
  }

  const targetObjectId = new Types.ObjectId(targetUserId);
  const existing = await Conversation.findOne({
    participant_ids: { $all: [userId, targetObjectId] },
  })
    .select('_id')
    .lean();

  if (!existing) {
    await assertDirectMessageAllowed(userId, targetObjectId);
  }

  const conversationId = existing
    ? existing._id
    : (
        await Conversation.create({
          participant_ids: [userId, targetObjectId],
          last_message: '',
          updated_at: new Date(),
        })
      )._id;

  return { kind: 'conversation' as const, conversationId };
}

async function assertDirectMessageAllowed(
  userId: Types.ObjectId,
  targetUserId: Types.ObjectId,
): Promise<void> {
  const targetUser = await User.findById(targetUserId);
  if (!targetUser) {
    throw new ConversationRequestError(404, 'Target user not found.');
  }

  const privacy = targetUser.dmPrivacy || 'everyone';
  if (privacy === 'everyone') return;

  const targetFollowing = (targetUser.following || []).map(String);
  const targetFollowsRequester = targetFollowing.includes(String(userId));
  if (privacy === 'following' && !targetFollowsRequester) {
    throwDirectMessagePrivacyError(
      "This user's privacy settings restrict who can send them direct messages.",
    );
  }
  if (privacy !== 'friends') return;

  const requester = await User.findById(userId);
  const requesterFollowing = (requester?.following || []).map(String);
  const requesterFollowsTarget = requesterFollowing.includes(String(targetUserId));
  if (!targetFollowsRequester || !requesterFollowsTarget) {
    throwDirectMessagePrivacyError(
      "This user's privacy settings restrict direct messages to mutual friends.",
    );
  }
}

function throwDirectMessagePrivacyError(message: string): never {
  throw new ConversationRequestError(403, message);
}
