import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

// ─── Interface ────────────────────────────────────────────────────────────────

/**
 * Represents the shape of a User document in MongoDB.
 * Aligns with PROJECT_SPEC.md § 6.1 — Users Collection.
 */
export interface IUser extends Document {
  username: string;      // unique handle, e.g. "@helloduongnha"
  display_name: string;  // human-readable name shown on the UI
  email: string;         // used for login — not exposed publicly
  password: string;      // bcrypt-hashed — never returned in responses
  avatar: string;        // URL to profile picture
  bio: string;           // short user biography
  follower_count: number;
  followers: any[];
  following: any[];
  isPrivateAccount: boolean;
  dmPrivacy: 'everyone' | 'following' | 'friends';
  defaultPrivacy: 'public' | 'private';
  followersPrivacy: 'everyone' | 'following' | 'only_me';
  followingPrivacy: 'everyone' | 'following' | 'only_me';
  // ── Streak & Rank ─────────────────────────────────────────────────────────
  lastLoginDate: Date;
  loginHistory: string[];    // 'YYYY-MM-DD' strings
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
  birth_date?: string;
  birth_hour?: string;
  fullName?: string;
  gender?: string;
  sessions: {
    _id: mongoose.Types.ObjectId;
    userAgent: string;
    deviceOS: string;
    deviceBrowser: string;
    ipAddress: string;
    lastActive: Date;
  }[];
  createdAt: Date;
  updatedAt: Date;

  /** Instance method: compare a plaintext password against the stored hash */
  comparePassword(candidatePassword: string): Promise<boolean>;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

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
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false, // never returned in query results by default
    },
    avatar: {
      type: String,
      default: '',
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
    // ── Streak & Rank ─────────────────────────────────────────────────────
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
    birth_date: {
      type: String,
      default: '',
    },
    birth_hour: {
      type: String,
      default: '',
    },
    fullName: {
      type: String,
      default: '',
    },
    gender: {
      type: String,
      default: '',
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
      },
    ],
  },
  {
    timestamps: true, // auto-manages createdAt & updatedAt
  },
);

// ─── Note on Indexes ─────────────────────────────────────────────────────────
// `unique: true` on username and email (above) already instructs Mongoose to
// create unique indexes for both fields automatically. No extra .index() calls
// are needed — adding them would create duplicate indexes and trigger Mongoose
// deprecation warnings under concurrent load.

// ─── Pre-save Hook: Password Hashing ─────────────────────────────────────────

UserSchema.pre('save', async function () {
  // Only re-hash if the password field was actually modified
  if (!this.isModified('password')) return;

  const saltRounds = 12;
  this.password = await bcrypt.hash(this.password as string, saltRounds);
});

// ─── Instance Method: Password Comparison ────────────────────────────────────

UserSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

// ─── Model Export ─────────────────────────────────────────────────────────────

export default mongoose.model<IUser>('User', UserSchema);
