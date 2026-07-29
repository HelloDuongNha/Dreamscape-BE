import { IUser } from '../../models/User';

export function presentAuthenticatedUser(user: IUser) {
  return {
    _id: user._id,
    username: user.username,
    display_name: user.display_name,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    bio: user.bio,
    follower_count: user.followers ? user.followers.length : 0,
    followers: (user.followers || []).map((id: any) =>
      id.toString ? id.toString() : String(id),
    ),
    following: (user.following || []).map((id: any) =>
      id.toString ? id.toString() : String(id),
    ),
    followRequestCount: user.followRequests?.length || 0,
    isPrivateAccount: user.isPrivateAccount || false,
    dmPrivacy: user.dmPrivacy || 'everyone',
    defaultPrivacy: user.defaultPrivacy || 'public',
    followersPrivacy: user.followersPrivacy || 'everyone',
    followingPrivacy: user.followingPrivacy || 'everyone',
    createdAt: user.createdAt,
    birth_date: (user as any).birth_date || '',
    birth_hour: (user as any).birth_hour || '',
    fullName: (user as any).fullName || '',
    gender: (user as any).gender || '',
    loginHistory: user.loginHistory || [],
    streakCount: user.streakCount ?? 0,
    rankPoints: user.rankPoints ?? 0,
    currentRank: user.currentRank || 'Nhà Mơ Mộng Mới',
    dailyTasks: user.dailyTasks || {
      likeOtherPost: false,
      commentOtherPost: false,
      createPost: false,
      lastResetDate: '',
    },
  };
}
