/**
 * Builds the public/profile response shape shared by Identity and Social.
 * Privacy decisions remain owned by Identity even when a Social action
 * returns the updated profile.
 */
export function sanitizeOtherUser(user: any, myId: string) {
  const isOwner = myId === user._id.toString();
  const viewerIsFollower = (user.followers || []).some((candidate: any) => {
    const candidateId = candidate._id ? candidate._id.toString() : candidate.toString();
    return candidateId === myId;
  });
  const followRequestPending = (user.followRequests || []).some((candidate: any) => {
    const candidateId = candidate._id ? candidate._id.toString() : candidate.toString();
    return candidateId === myId;
  });
  const statsVisible = !user.isPrivateAccount || isOwner || viewerIsFollower;
  const targetFollowsMe = (user.following || []).some((candidate: any) => {
    const candidateId = candidate._id ? candidate._id.toString() : candidate.toString();
    return candidateId === myId;
  });

  const canViewFollowers = statsVisible && (user.followersPrivacy === 'everyone'
    || !user.followersPrivacy
    || (user.followersPrivacy === 'following' && (isOwner || targetFollowsMe))
    || (user.followersPrivacy === 'only_me' && isOwner));

  const canViewFollowing = statsVisible && (user.followingPrivacy === 'everyone'
    || !user.followingPrivacy
    || (user.followingPrivacy === 'following' && (isOwner || targetFollowsMe))
    || (user.followingPrivacy === 'only_me' && isOwner));

  const mapFollowList = (list: any[]) => (list || []).map((candidate: any) => {
    if (candidate && typeof candidate === 'object' && candidate.username) {
      return {
        _id: candidate._id,
        username: candidate.username,
        display_name: candidate.display_name,
        avatar: candidate.avatar || '',
      };
    }
    return { _id: candidate._id || candidate };
  });

  return {
    _id: user._id,
    username: user.username,
    display_name: user.display_name,
    avatar: user.avatar || '',
    bio: user.bio || '',
    follower_count: statsVisible && user.followers ? user.followers.length : 0,
    followers: (statsVisible ? user.followers || [] : []).map((candidate: any) => (
      candidate._id ? candidate._id.toString() : candidate.toString()
    )),
    following: (statsVisible ? user.following || [] : []).map((candidate: any) => (
      candidate._id ? candidate._id.toString() : candidate.toString()
    )),
    followersList: canViewFollowers ? mapFollowList(user.followers) : [],
    followingList: canViewFollowing ? mapFollowList(user.following) : [],
    followRequests: isOwner ? mapFollowList(user.followRequests) : [],
    followRequestCount: isOwner ? user.followRequests?.length || 0 : undefined,
    followStatus: viewerIsFollower
      ? 'following'
      : followRequestPending
        ? 'pending'
        : 'none',
    statsVisible,
    canViewPrivateContent: !user.isPrivateAccount || isOwner || viewerIsFollower,
    followersPrivacy: user.followersPrivacy || 'everyone',
    followingPrivacy: user.followingPrivacy || 'everyone',
    isPrivateAccount: user.isPrivateAccount || false,
    dmPrivacy: user.dmPrivacy || 'everyone',
    defaultPrivacy: user.defaultPrivacy || 'public',
    lastHeartbeatAt: user.lastHeartbeatAt,
    createdAt: user.createdAt,
    streakCount: user.streakCount ?? 0,
    highestStreak: user.highestStreak ?? 0,
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
