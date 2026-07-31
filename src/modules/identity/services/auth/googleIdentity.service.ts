import { getFirebaseAuth } from '../../../../config/firebaseAdmin';

export interface VerifiedGoogleIdentity {
  uid: string;
  email: string;
  name?: string;
  picture?: string;
}

export class GoogleIdentityVerificationError extends Error {
  constructor(public readonly reason: 'token_required' | 'verification_failed') {
    super(reason);
    this.name = 'GoogleIdentityVerificationError';
  }
}

// Verifies a fresh Firebase Google token before an identity-sensitive action.
export async function verifyGoogleIdentity(idToken: string): Promise<VerifiedGoogleIdentity> {
  if (!idToken.trim()) {
    throw new GoogleIdentityVerificationError('token_required');
  }

  let decoded;
  try {
    decoded = await getFirebaseAuth().verifyIdToken(idToken, true);
  } catch {
    throw new GoogleIdentityVerificationError('verification_failed');
  }

  if (
    decoded.firebase?.sign_in_provider !== 'google.com'
    || !decoded.email
    || decoded.email_verified !== true
  ) {
    throw new GoogleIdentityVerificationError('verification_failed');
  }

  return {
    uid: decoded.uid,
    email: decoded.email.trim().toLowerCase(),
    name: decoded.name,
    picture: decoded.picture,
  };
}
