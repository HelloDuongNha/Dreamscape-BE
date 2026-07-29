import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  username: string;
  display_name: string;
  email: string;
  role: 'admin' | 'user';
  password: string;
  authMethod: 'password' | 'google' | 'password_google';
  avatar: string;
  avatarAsset?: {
    provider: 'cloudinary';
    publicId: string;
  };
  bio: string;
  follower_count: number;
  followers: any[];
  following: any[];
  followRequests: any[];
  isPrivateAccount: boolean;
  dmPrivacy: 'everyone' | 'following' | 'friends';
  defaultPrivacy: 'public' | 'private';
  followersPrivacy: 'everyone' | 'following' | 'only_me';
  followingPrivacy: 'everyone' | 'following' | 'only_me';
  lastLoginDate: Date;
  loginHistory: string[];
  streakCount: number;
  highestStreak: number;
  rankPoints: number;
  currentRank: string;
  dailyTasks: {
    likeOtherPost: boolean;
    commentOtherPost: boolean;
    createPost: boolean;
    lastResetDate: string;
  };
  achievements: string[];
  timeOnlineToday: number;
  totalTimeOnline: number;
  lastActiveDate: string;
  lastHeartbeatAt?: Date;
  sessions: {
    _id: mongoose.Types.ObjectId;
    userAgent: string;
    deviceOS: string;
    deviceBrowser: string;
    ipAddress: string;
    lastActive: Date;
    authenticatedAt?: Date;
  }[];
  createdAt: Date;
  updatedAt: Date;

  comparePassword(candidatePassword: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>(
  {
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [30, 'Username must not exceed 30 characters'],
    },
    display_name: {
      type: String,
      required: [true, 'Display name is required'],
      trim: true,
      maxlength: [50, 'Display name must not exceed 50 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address'],
    },
    role: {
      type: String,
      enum: ['admin', 'user'],
      default: 'user',
      required: true,
      index: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,
    },
    authMethod: {
      type: String,
      enum: ['password', 'google', 'password_google'],
      default: 'password',
    },
    avatar: {
      type: String,
      default: '',
    },
    avatarAsset: {
      provider: {
        type: String,
        enum: ['cloudinary'],
      },
      publicId: {
        type: String,
        trim: true,
      },
      _id: false,
    },
    bio: {
      type: String,
      default: '',
      maxlength: [160, 'Bio must not exceed 160 characters'],
    },
    follower_count: {
      type: Number,
      default: 0,
      min: 0,
    },
    followers: [{
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: [],
    }],
    following: [{
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: [],
    }],
    followRequests: [{
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: [],
    }],
    isPrivateAccount: {
      type: Boolean,
      default: false,
    },
    dmPrivacy: {
      type: String,
      enum: ['everyone', 'following', 'friends'],
      default: 'everyone',
    },
    defaultPrivacy: {
      type: String,
      enum: ['public', 'private'],
      default: 'public',
    },
    followersPrivacy: {
      type: String,
      enum: ['everyone', 'following', 'only_me'],
      default: 'everyone',
    },
    followingPrivacy: {
      type: String,
      enum: ['everyone', 'following', 'only_me'],
      default: 'everyone',
    },
    lastLoginDate: {
      type: Date,
    },
    loginHistory: {
      type: [String],
      default: [],
    },
    streakCount: {
      type: Number,
      default: 0,
    },
    highestStreak: {
      type: Number,
      default: 0,
    },
    rankPoints: {
      type: Number,
      default: 0,
    },
    currentRank: {
      type: String,
      default: 'Nhà Mơ Mộng Mới',
    },
    dailyTasks: {
      likeOtherPost: { type: Boolean, default: false },
      commentOtherPost: { type: Boolean, default: false },
      createPost: { type: Boolean, default: false },
      lastResetDate: { type: String, default: '' },
    },
    achievements: {
      type: [String],
      default: [],
    },
    timeOnlineToday: {
      type: Number,
      default: 0,
    },
    totalTimeOnline: {
      type: Number,
      default: 0,
    },
    lastActiveDate: {
      type: String,
      default: '',
    },
    lastHeartbeatAt: {
      type: Date,
    },
    sessions: [
      {
        _id: {
          type: Schema.Types.ObjectId,
          default: () => new mongoose.Types.ObjectId(),
        },
        userAgent: {
          type: String,
          default: '',
        },
        deviceOS: {
          type: String,
          default: '',
        },
        deviceBrowser: {
          type: String,
          default: '',
        },
        ipAddress: {
          type: String,
          default: '',
        },
        lastActive: {
          type: Date,
          default: Date.now,
        },
        authenticatedAt: {
          type: Date,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

UserSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  // Registration stores only a bcrypt hash in the short-lived OTP payload.
  // `$locals` is server-only and prevents that trusted hash from being hashed twice.
  if (this.$locals.passwordAlreadyHashed === true) return;
  const saltRounds = 12;
  this.password = await bcrypt.hash(this.password as string, saltRounds);
});

UserSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model<IUser>('User', UserSchema);
