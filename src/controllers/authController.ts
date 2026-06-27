import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User';
import Otp from '../models/Otp';
import UserDreamProfile from '../models/UserDreamProfile';
import { sendOtpEmail } from '../services/emailService';
import { parseUserAgent } from '../utils/userAgent';
import { buildCulturalProfile, buildScoringProfile } from '../services/profileBuilder.service';
import { logger } from '../utils/logger';

// ─── Helper: Sign JWT ─────────────────────────────────────────────────────────

/**
 * Creates a signed JWT containing the user's MongoDB _id.
 * Expiry is driven by the JWT_EXPIRES_IN environment variable (default: 7d).
 */
const signToken = (userId: string, sessionId?: string): string => {
  const secret = process.env.JWT_SECRET!;
  const expiresIn = (process.env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn']) ?? '7d';
  return jwt.sign({ id: userId, sessionId }, secret, { expiresIn });
};

// ─── Helper: Safe User Profile ────────────────────────────────────────────────

/**
 * Strips sensitive fields (password) before sending user data to the client.
 */
const sanitizeUser = (user: InstanceType<typeof User>) => ({
  _id: user._id,
  username: user.username,
  display_name: user.display_name,
  email: user.email,
  avatar: user.avatar,
  bio: user.bio,
  follower_count: user.followers ? user.followers.length : 0,
  followers: (user.followers || []).map((id: any) => id.toString ? id.toString() : String(id)),
  following: (user.following || []).map((id: any) => id.toString ? id.toString() : String(id)),
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
  // ── Streak & Rank ─────────────────────────────────────────────────────────
  loginHistory: user.loginHistory || [],
  streakCount:  user.streakCount  ?? 0,
  rankPoints:   user.rankPoints   ?? 0,
  currentRank:  user.currentRank  || 'Nhà Mơ Mộng Mới',
  dailyTasks:   user.dailyTasks || {
    likeOtherPost: false,
    commentOtherPost: false,
    createPost: false,
    lastResetDate: '',
  },
});

// ─── POST /api/auth/register ──────────────────────────────────────────────────

/**
 * Registers a new user account.
 * - Validates that `username` and `email` are not already taken.
 * - Generates OTP, stores the registration payload in the Otp model, and sends a Resend email.
 */
export const register = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { username, display_name, email, password, avatar, bio } = req.body as {
      username: string;
      display_name: string;
      email: string;
      password: string;
      avatar?: string;
      bio?: string;
    };

    if (!username || !display_name || !email || !password) {
      res.status(400).json({ success: false, message: 'All required fields must be provided.' });
      return;
    }

    // Format username: ensure it starts with @
    let formattedUsername = username.trim();
    if (!formattedUsername.startsWith('@')) {
      formattedUsername = '@' + formattedUsername;
    }

    // Duplicate check (index ensures uniqueness, but we give a clear message)
    const existing = await User.findOne({
      $or: [
        { email: email.toLowerCase() },
        { username: formattedUsername }
      ]
    });
    if (existing) {
      const field = existing.email.toLowerCase() === email.toLowerCase() ? 'email' : 'username';
      res.status(409).json({
        success: false,
        message: `An account with this ${field} already exists.`,
      });
      return;
    }

    // Generate random 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Clean up older registration OTPs for this email
    await Otp.deleteMany({ email: email.toLowerCase(), purpose: 'register' });

    // Store in Otp collection
    await Otp.create({
      email: email.toLowerCase(),
      otpCode,
      purpose: 'register',
      payload: {
        username: formattedUsername,
        display_name: display_name.trim(),
        email: email.toLowerCase(),
        password,
        avatar: avatar ?? '',
        bio: bio ?? '',
      },
    });

    // Send email
    await sendOtpEmail(email.toLowerCase(), otpCode, 'register');

    res.status(200).json({
      success: true,
      status: 'pending',
      email: email.toLowerCase(),
      message: 'Verification OTP sent to your email. Please verify to complete registration.',
    });
  } catch (error) {
    next(error);
  }
};

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

/**
 * Authenticates a user with email + password.
 * Returns a signed JWT and the user's public profile on success.
 */
export const login = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { email, password } = req.body as { email: string; password: string };

    // Explicitly select password (excluded by default via `select: false`)
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
      return;
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
      return;
    }

    const userAgentStr = req.headers['user-agent'] || '';
    const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    const { deviceOS, deviceBrowser } = parseUserAgent(userAgentStr);

    const sessionId = new mongoose.Types.ObjectId();
    user.sessions.push({
      _id: sessionId,
      userAgent: userAgentStr,
      deviceOS,
      deviceBrowser,
      ipAddress,
      lastActive: new Date()
    });

    if (user.sessions.length > 20) {
      user.sessions.shift();
    }

    await user.save();

    const token = signToken(String(user._id), String(sessionId));

    res.status(200).json({
      success: true,
      message: 'Login successful.',
      token,
      user: sanitizeUser(user),
    });
  } catch (error) {
    next(error);
  }
};

// ─── POST /api/auth/logout ────────────────────────────────────────────────────

/**
 * Stateless logout — instructs the client to discard its token.
 * For JWT-based auth, token invalidation is handled client-side.
 * A token blacklist / Redis strategy can be added in a future phase.
 */
export const logout = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const user = req.user!;
    if (req.sessionId) {
      user.sessions = user.sessions.filter((s) => String(s._id) !== String(req.sessionId));
      await user.save();
    }
    res.status(200).json({
      success: true,
      message: 'Logged out successfully. Please discard your token on the client.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/auth/profile
 * Update authenticated user's profile details.
 */
export const updateProfile = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const myId = req.user!._id;
    const {
      display_name,
      username,
      email,
      bio,
      currentPassword,
      newPassword,
      defaultPrivacy,
      isPrivateAccount,
      dmPrivacy,
      followersPrivacy,
      followingPrivacy,
      birth_date,
      birth_hour,
      fullName,
      gender,
    } = req.body as {
      display_name?: string;
      username?: string;
      email?: string;
      bio?: string;
      currentPassword?: string;
      newPassword?: string;
      defaultPrivacy?: 'public' | 'private';
      isPrivateAccount?: boolean;
      dmPrivacy?: 'everyone' | 'following' | 'friends';
      followersPrivacy?: 'everyone' | 'following' | 'only_me';
      followingPrivacy?: 'everyone' | 'following' | 'only_me';
      birth_date?: string;
      birth_hour?: string;
      fullName?: string;
      gender?: string;
    };

    if (
      display_name === undefined &&
      username === undefined &&
      email === undefined &&
      bio === undefined &&
      newPassword === undefined &&
      defaultPrivacy === undefined &&
      isPrivateAccount === undefined &&
      dmPrivacy === undefined &&
      followersPrivacy === undefined &&
      followingPrivacy === undefined &&
      birth_date === undefined &&
      birth_hour === undefined &&
      fullName === undefined &&
      gender === undefined
    ) {
      res.status(400).json({ success: false, message: 'Update payload cannot be empty.' });
      return;
    }

    const user = await User.findById(myId).select('+password');
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    // ── Validate Display Name ──────────────────────────────────────────
    if (display_name !== undefined) {
      if (!display_name || display_name.trim() === '') {
        res.status(400).json({ success: false, message: 'Display name cannot be empty.' });
        return;
      }
      user.display_name = display_name.trim();
    }

    // ── Validate Username ──────────────────────────────────────────────
    if (username !== undefined) {
      let formattedUsername = username.trim();
      if (formattedUsername === '' || formattedUsername === '@') {
        res.status(400).json({ success: false, message: 'Username cannot be empty.' });
        return;
      }
      if (!formattedUsername.startsWith('@')) {
        formattedUsername = '@' + formattedUsername;
      }

      const handle = formattedUsername.slice(1);
      const usernameRegex = /^[a-zA-Z0-9_]+$/;
      if (!usernameRegex.test(handle)) {
        res.status(400).json({
          success: false,
          message: 'Username can only contain letters, numbers, and underscores after the @.',
        });
        return;
      }

      if (formattedUsername.length < 3 || formattedUsername.length > 30) {
        res.status(400).json({
          success: false,
          message: 'Username must be between 3 and 30 characters.',
        });
        return;
      }

      // Check if username is already taken by another user
      const existingUser = await User.findOne({ username: formattedUsername, _id: { $ne: myId } });
      if (existingUser) {
        res.status(409).json({
          success: false,
          field: 'username',
          message: 'Username is already taken.',
        });
        return;
      }
      user.username = formattedUsername;
    }

    // ── Validate Email ─────────────────────────────────────────────────
    if (email !== undefined) {
      const formattedEmail = email.trim().toLowerCase();
      if (!formattedEmail) {
        res.status(400).json({ success: false, message: 'Email cannot be empty.' });
        return;
      }
      const emailRegex = /^\S+@\S+\.\S+$/;
      if (!emailRegex.test(formattedEmail)) {
        res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
        return;
      }

      // Check if email is already taken by another user
      const existingEmail = await User.findOne({ email: formattedEmail, _id: { $ne: myId } });
      if (existingEmail) {
        res.status(409).json({
          success: false,
          field: 'email',
          message: 'Email address is already taken.',
        });
        return;
      }

      if (formattedEmail !== user.email) {
        // Generate random 6-digit OTP
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

        // Remove any old update_email OTPs for this new email
        await Otp.deleteMany({ email: formattedEmail, purpose: 'update_email' });

        // Save Otp
        await Otp.create({
          email: formattedEmail,
          otpCode,
          purpose: 'update_email',
          payload: {
            userId: user._id,
            email: formattedEmail,
          },
        });

        // Send email
        await sendOtpEmail(formattedEmail, otpCode, 'update_email');

        res.status(200).json({
          success: true,
          status: 'pending',
          email: formattedEmail,
          message: 'Verification OTP sent to your new email. Please verify to complete update.',
        });
        return;
      }
    }

    // ── Validate Bio ───────────────────────────────────────────────────
    if (bio !== undefined) {
      user.bio = bio.trim();
    }

    // ── Validate Password Update ───────────────────────────────────────
    if (newPassword !== undefined) {
      if (!currentPassword) {
        res.status(400).json({ success: false, message: 'Current password is required to set a new password.' });
        return;
      }
      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        res.status(401).json({ success: false, message: 'Incorrect current password.' });
        return;
      }
      if (newPassword.length < 6) {
        res.status(400).json({ success: false, message: 'New password must be at least 6 characters.' });
        return;
      }
      user.password = newPassword;
    }

    // ── Validate Default Privacy ───────────────────────────────────────
    if (defaultPrivacy !== undefined) {
      if (defaultPrivacy !== 'public' && defaultPrivacy !== 'private') {
        res.status(400).json({ success: false, message: 'Invalid default privacy mode.' });
        return;
      }
      user.defaultPrivacy = defaultPrivacy;
    }

    // ── Validate Account Privacy ───────────────────────────────────────
    if (isPrivateAccount !== undefined) {
      user.isPrivateAccount = isPrivateAccount;
    }

    // ── Validate DM Privacy ────────────────────────────────────────────
    if (dmPrivacy !== undefined) {
      if (dmPrivacy !== 'everyone' && dmPrivacy !== 'following' && dmPrivacy !== 'friends') {
        res.status(400).json({ success: false, message: 'Invalid DM privacy setting.' });
        return;
      }
      user.dmPrivacy = dmPrivacy;
    }

    // ── Validate Followers Privacy ─────────────────────────────────────
    if (followersPrivacy !== undefined) {
      if (followersPrivacy !== 'everyone' && followersPrivacy !== 'following' && followersPrivacy !== 'only_me') {
        res.status(400).json({ success: false, message: 'Invalid followers privacy setting.' });
        return;
      }
      user.followersPrivacy = followersPrivacy;
    }

    // ── Validate Following Privacy ─────────────────────────────────────
    if (followingPrivacy !== undefined) {
      if (followingPrivacy !== 'everyone' && followingPrivacy !== 'following' && followingPrivacy !== 'only_me') {
        res.status(400).json({ success: false, message: 'Invalid following privacy setting.' });
        return;
      }
      user.followingPrivacy = followingPrivacy;
    }

    // ── Update Birth Details & Full Name / Gender ───────────────────────
    const u = user as any;
    if (birth_date !== undefined) {
      u.birth_date = birth_date;
    }
    if (birth_hour !== undefined) {
      u.birth_hour = birth_hour;
    }
    if (fullName !== undefined) {
      u.fullName = fullName;
    }
    if (gender !== undefined) {
      u.gender = gender;
    }

    await user.save();

    // Trigger deterministic user dream profile update/upsert
    const computedCulturalData = buildCulturalProfile(u.birth_date || '', u.birth_hour || '');
    try {
      const existingProfile = await UserDreamProfile.findOne({ userId: user._id });
      const measuredProfile = existingProfile ? existingProfile.measuredPsychologicalProfile : undefined;
      const computedScoringProfile = buildScoringProfile(measuredProfile);

      await UserDreamProfile.updateOne(
        { userId: user._id },
        {
          $set: {
            basicProfile: {
              fullName: u.fullName || '',
              gender: u.gender || 'unknown',
              birthDate: u.birth_date || '',
              birthHour: u.birth_hour || '',
              birthTimeUnknown: !u.birth_hour || u.birth_hour === 'none'
            },
            culturalProfile: computedCulturalData,
            scoringProfile: computedScoringProfile,
            updatedAt: new Date()
          },
          $setOnInsert: {
            measuredPsychologicalProfile: {
              bigFive: { enabled: false, source: null, openness: null, conscientiousness: null, extraversion: null, agreeableness: null, neuroticism: null },
              chronotype: { enabled: false, source: null, type: null },
              schemas: { enabled: false, source: null, detectedSchemas: [] }
            },
            learnedPersonalPattern: { totalDreams: 0, commonSymbols: [], commonThemes: [], commonEmotions: [], averageDreamScore: null },
            preferences: { allowCulturalAnalysis: true, allowFingerprintAnalysis: false, allowPsychologicalPersonalization: false, allowCommunitySimilarity: false },
            createdAt: new Date()
          }
        },
        { upsert: true }
      );
      logger.info('User dream profile updated successfully.', { userId: String(user._id) });
    } catch (err) {
      logger.error('Failed to update user dream profile.', err, { userId: String(user._id) });
    }

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      user: sanitizeUser(user),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/verify-otp
 * Verify OTP code and commit pending action (registration or email update).
 */
export const verifyOtp = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { email, otpCode, purpose } = req.body as {
      email:    string;
      otpCode:  string;
      purpose:  'register' | 'update_email' | 'forgot_password';
    };

    if (!email || !otpCode || !purpose) {
      res.status(400).json({ success: false, message: 'Email, OTP code, and purpose are required.' });
      return;
    }

    const record = await Otp.findOne({
      email: email.toLowerCase(),
      otpCode: otpCode.trim(),
      purpose,
    });

    if (!record) {
      res.status(400).json({ success: false, message: 'Invalid or expired verification code.' });
      return;
    }

    // On match: execute purpose-specific commit
    if (purpose === 'register') {
      const payload = record.payload;
      if (!payload) {
        res.status(400).json({ success: false, message: 'Pending registration data not found.' });
        return;
      }

      // Check one last time if username or email was taken in the meantime
      const existing = await User.findOne({ $or: [{ email: payload.email }, { username: payload.username }] });
      if (existing) {
        const field = existing.email === payload.email ? 'email' : 'username';
        res.status(409).json({
          success: false,
          message: `An account with this ${field} was already registered.`,
        });
        return;
      }

      // Officially commit the user
      const user = await User.create(payload);

      // Create session
      const userAgentStr = req.headers['user-agent'] || '';
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
      const { deviceOS, deviceBrowser } = parseUserAgent(userAgentStr);

      const sessionId = new mongoose.Types.ObjectId();
      user.sessions = [{
        _id: sessionId,
        userAgent: userAgentStr,
        deviceOS,
        deviceBrowser,
        ipAddress,
        lastActive: new Date()
      }];
      await user.save();

      // Generate JWT
      const token = signToken(String(user._id), String(sessionId));

      // Initialize the deterministic User Dream Profile upon registration
      const u = user as any;
      const computedCulturalData = buildCulturalProfile(u.birth_date || '', u.birth_hour || '');
      const computedScoringProfile = buildScoringProfile(undefined);
      try {
        await UserDreamProfile.updateOne(
          { userId: user._id },
          {
            $set: {
              basicProfile: {
                fullName: u.fullName || '',
                gender: u.gender || 'unknown',
                birthDate: u.birth_date || '',
                birthHour: u.birth_hour || '',
                birthTimeUnknown: !u.birth_hour || u.birth_hour === 'none'
              },
              culturalProfile: computedCulturalData,
              scoringProfile: computedScoringProfile,
              updatedAt: new Date()
            },
            $setOnInsert: {
              measuredPsychologicalProfile: {
                bigFive: { enabled: false, source: null, openness: null, conscientiousness: null, extraversion: null, agreeableness: null, neuroticism: null },
                chronotype: { enabled: false, source: null, type: null },
                schemas: { enabled: false, source: null, detectedSchemas: [] }
              },
              learnedPersonalPattern: { totalDreams: 0, commonSymbols: [], commonThemes: [], commonEmotions: [], averageDreamScore: null },
              preferences: { allowCulturalAnalysis: true, allowFingerprintAnalysis: false, allowPsychologicalPersonalization: false, allowCommunitySimilarity: false },
              createdAt: new Date()
            }
          },
          { upsert: true }
        );
        logger.info('User dream profile initialized upon registration verification.', { userId: String(user._id) });
      } catch (err) {
        logger.error('Failed to initialize user dream profile.', err, { userId: String(user._id) });
      }

      // Clean up OTP record
      await record.deleteOne();

      res.status(201).json({
        success: true,
        message: 'Account verified and created successfully.',
        token,
        user: sanitizeUser(user),
      });
      return;
    }

    if (purpose === 'update_email') {
      const payload = record.payload;
      if (!payload || !payload.userId || !payload.email) {
        res.status(400).json({ success: false, message: 'Pending email update data not found.' });
        return;
      }

      // Find user
      const user = await User.findById(payload.userId);
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found.' });
        return;
      }

      // Verify email isn't taken in the meantime
      const existing = await User.findOne({ email: payload.email, _id: { $ne: user._id } });
      if (existing) {
        res.status(409).json({ success: false, message: 'Email address is already taken.' });
        return;
      }

      // Update email
      user.email = payload.email;
      await user.save();

      // Clean up OTP
      await record.deleteOne();

      res.status(200).json({
        success: true,
        message: 'Email address verified and updated successfully.',
        user: sanitizeUser(user),
      });
      return;
    }

    if (purpose === 'forgot_password') {
      res.status(200).json({
        success: true,
        message: 'Code verified successfully. You can now reset your password.',
      });
      return;
    }

    res.status(400).json({ success: false, message: 'Unsupported verification purpose.' });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/forgot-password
 * Initiate password recovery.
 */
export const forgotPassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { email } = req.body as { email: string };
    if (!email) {
      res.status(400).json({ success: false, message: 'Email is required.' });
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      res.status(200).json({
        success: true,
        message: 'If the email matches an active account, a password reset code has been sent.',
      });
      return;
    }

    // Generate random 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Clean up older forgot_password OTPs for this email
    await Otp.deleteMany({ email: email.toLowerCase(), purpose: 'forgot_password' });

    // Save Otp
    await Otp.create({
      email: email.toLowerCase(),
      otpCode,
      purpose: 'forgot_password',
    });

    // Send email
    await sendOtpEmail(email.toLowerCase(), otpCode, 'forgot_password');

    res.status(200).json({
      success: true,
      message: 'If the email matches an active account, a password reset code has been sent.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/reset-password
 * Reset user password using OTP.
 */
export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { email, otpCode, newPassword } = req.body as {
      email:       string;
      otpCode:     string;
      newPassword: string;
    };

    if (!email || !otpCode || !newPassword) {
      res.status(400).json({ success: false, message: 'Email, OTP code, and new password are required.' });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ success: false, message: 'New password must be at least 6 characters.' });
      return;
    }

    // Check code
    const record = await Otp.findOne({
      email: email.toLowerCase(),
      otpCode: otpCode.trim(),
      purpose: 'forgot_password',
    });

    if (!record) {
      res.status(400).json({ success: false, message: 'Invalid or expired verification code.' });
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    // Update password (pre-save hook will hash it)
    user.password = newPassword;
    await user.save();

    // Delete OTP code
    await record.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Password reset successfully. You can now log in with your new password.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/resend-otp
 * Resend verification OTP code for an active pending operation (register, update_email, forgot_password).
 */
export const resendOtp = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { email, purpose } = req.body as {
      email:   string;
      purpose: 'register' | 'update_email' | 'forgot_password';
    };

    if (!email || !purpose) {
      res.status(400).json({ success: false, message: 'Email and purpose are required.' });
      return;
    }

    // Check if there is an active OTP session
    const existing = await Otp.findOne({ email: email.toLowerCase(), purpose });
    if (!existing && purpose !== 'forgot_password') {
      res.status(404).json({ success: false, message: 'No active verification request found. Please try again from the start.' });
      return;
    }

    // Generate new OTP code
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    if (existing) {
      existing.otpCode = otpCode;
      existing.createdAt = new Date(); // refresh TTL
      await existing.save();
    } else {
      // For forgot_password, if it expired/doesn't exist, we can recreate it
      await Otp.create({
        email: email.toLowerCase(),
        otpCode,
        purpose,
      });
    }

    // Send email
    await sendOtpEmail(email.toLowerCase(), otpCode, purpose);

    res.status(200).json({
      success: true,
      message: 'A new verification code has been sent to your email.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/auth/sessions
 * Fetch active device sessions list for the authenticated user.
 */
export const getSessions = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const user = req.user!;
    const activeSessions = user.sessions.map((s) => ({
      _id: s._id,
      device_name: s.deviceOS || 'Unknown OS',
      browser: s.deviceBrowser || 'Unknown Browser',
      location: s.ipAddress || 'Unknown IP',
      last_active: s.lastActive,
      is_current: String(s._id) === String(req.sessionId),
    }));

    res.status(200).json({
      success: true,
      sessions: activeSessions,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/auth/sessions/:id
 * Revoke a specific login session.
 */
export const revokeSession = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ success: false, message: 'Session ID is required.' });
      return;
    }

    if (String(id) === String(req.sessionId)) {
      res.status(400).json({
        success: false,
        message: 'Cannot revoke the current active session. Use the logout endpoint instead.',
      });
      return;
    }

    const user = req.user!;
    user.sessions = user.sessions.filter((s) => String(s._id) !== String(id));
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Session revoked successfully.',
    });
  } catch (error) {
    next(error);
  }
};
