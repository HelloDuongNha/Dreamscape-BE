import type { Types } from 'mongoose';
import type { DreamPrivacy } from '../../dto/dreamPrivacy.dto';
import Dream from '../../models/Dream';
import { mapDreamResponse } from './dreamNarrative.service';

export type UpdateOwnedDreamPrivacyInput = {
  dreamId: Types.ObjectId;
  ownerId: Types.ObjectId;
  privacy: DreamPrivacy;
};

// Update both visibility fields in one write for old and new readers.
export async function updateOwnedDreamPrivacy(
  input: UpdateOwnedDreamPrivacyInput,
): Promise<unknown | null> {
  const dream = await Dream.findOneAndUpdate(
    { _id: input.dreamId, userId: input.ownerId },
    {
      $set: {
        privacy: input.privacy,
        is_public: input.privacy === 'public',
      },
    },
    { new: true },
  );
  return dream ? mapDreamResponse(dream) : null;
}
