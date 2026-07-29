import { Types } from 'mongoose';
import User from '../../identity/models/User';
import Conversation from '../models/Conversation';
import Message from '../models/Message';
import {
  createAllMessageQueryTokenSets,
} from './messagingCrypto.service';
import {
  presentMessageSafely,
  readConversationPreview,
} from './messagePersistence.service';

const USER_PUBLIC = 'username display_name avatar bio';
const MAX_MESSAGE_RESULTS = 50;

export interface MessagingConversationSearchResult {
  user: Record<string, unknown>;
  conversationId: string | null;
  last_message: string;
  updated_at: string | null;
  source: 'conversation' | 'following';
}

export interface MessagingMessageSearchResult {
  message: Record<string, unknown>;
  conversationId: string;
  partner: Record<string, unknown>;
}

export interface MessagingSearchResult {
  conversations: MessagingConversationSearchResult[];
  messages: MessagingMessageSearchResult[];
}

function normalizeSearchText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLocaleLowerCase('vi')
    .trim()
    .replace(/^@/, '');
}

function publicUser(user: any): Record<string, unknown> {
  return {
    _id: String(user?._id ?? ''),
    username: String(user?.username ?? ''),
    display_name: String(user?.display_name ?? ''),
    avatar: String(user?.avatar ?? ''),
    bio: String(user?.bio ?? ''),
  };
}

function userMatches(user: any, query: string): boolean {
  return normalizeSearchText(user?.username).includes(query)
    || normalizeSearchText(user?.display_name).includes(query);
}

const VIETNAMESE_CHARACTER_CLASSES: Record<string, string> = {
  a: '[aàáạảãăằắặẳẵâầấậẩẫ]',
  d: '[dđ]',
  e: '[eèéẹẻẽêềếệểễ]',
  i: '[iìíịỉĩ]',
  o: '[oòóọỏõôồốộổỗơờớợởỡ]',
  u: '[uùúụủũưừứựửữ]',
  y: '[yỳýỵỷỹ]',
};

function buildVietnameseInsensitiveRegex(query: string): RegExp {
  const pattern = Array.from(query)
    .map((character) => {
      if (VIETNAMESE_CHARACTER_CLASSES[character]) {
        return VIETNAMESE_CHARACTER_CLASSES[character];
      }
      if (/\s/.test(character)) return '\\s+';
      return character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(pattern, 'i');
}

export async function searchMessaging(
  myId: Types.ObjectId,
  rawQuery: string,
): Promise<MessagingSearchResult> {
  const query = normalizeSearchText(rawQuery);
  if (!query) return { conversations: [], messages: [] };

  const [currentUser, conversations] = await Promise.all([
    User.findById(myId).select('following').lean(),
    Conversation.find({ participant_ids: myId })
      .sort({ updated_at: -1 })
      .populate('participant_ids', USER_PUBLIC)
      .lean(),
  ]);

  if (!currentUser) return { conversations: [], messages: [] };

  const followingIds = (currentUser.following ?? []).map((id: unknown) => String(id));
  const followingUsers = followingIds.length
    ? await User.find({ _id: { $in: followingIds } }).select(USER_PUBLIC).lean()
    : [];

  const resultByUserId = new Map<string, MessagingConversationSearchResult>();
  const conversationPartnerById = new Map<string, Record<string, unknown>>();

  for (const conversation of conversations as any[]) {
    const partner = conversation.participant_ids.find(
      (participant: any) => String(participant?._id) !== String(myId),
    );
    if (!partner) continue;

    const conversationId = String(conversation._id);
    const partnerView = publicUser(partner);
    conversationPartnerById.set(conversationId, partnerView);

    if (userMatches(partner, query)) {
      resultByUserId.set(String(partner._id), {
        user: partnerView,
        conversationId,
        last_message: safeConversationPreview(conversation),
        updated_at: conversation.updated_at
          ? new Date(conversation.updated_at).toISOString()
          : null,
        source: 'conversation',
      });
    }
  }

  for (const followedUser of followingUsers as any[]) {
    if (!userMatches(followedUser, query)) continue;
    const userId = String(followedUser._id);
    if (resultByUserId.has(userId)) continue;
    resultByUserId.set(userId, {
      user: publicUser(followedUser),
      conversationId: null,
      last_message: '',
      updated_at: null,
      source: 'following',
    });
  }

  const conversationIds = conversations.map((conversation: any) => conversation._id);
  const messageResults: MessagingMessageSearchResult[] = [];

  if (conversationIds.length) {
    const encryptedTokenQueries = createAllMessageQueryTokenSets(query).map(item => ({
      searchKeyVersion: item.keyVersion,
      searchTokens: { $all: item.tokens },
    }));
    const candidateMessages = await Message.find({
      conversationId: { $in: conversationIds },
      $or: [
        ...encryptedTokenQueries,
        { content: { $regex: buildVietnameseInsensitiveRegex(query) } },
      ],
    })
      .sort({ timestamp: -1 })
      .limit(MAX_MESSAGE_RESULTS)
      .populate('senderId', USER_PUBLIC)
      .lean();

    for (const message of candidateMessages as any[]) {
      const conversationId = String(message.conversationId);
      const partner = conversationPartnerById.get(conversationId);
      if (!partner) continue;
      const presented = presentMessageSafely(message);
      if (
        presented.content_unavailable
        || !normalizeSearchText(presented.content).includes(query)
      ) continue;
      messageResults.push({
        message: {
          ...presented,
          _id: String(presented._id),
          conversationId,
        },
        conversationId,
        partner,
      });
    }
  }

  return {
    conversations: Array.from(resultByUserId.values()),
    messages: messageResults,
  };
}

function safeConversationPreview(conversation: any): string {
  try {
    return readConversationPreview(conversation);
  } catch {
    return '';
  }
}
