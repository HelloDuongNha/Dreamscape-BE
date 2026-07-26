import type { Request, Response } from 'express';
import type { Types } from 'mongoose';
import { parseDreamPrivacyRequest } from '../dto/dreamPrivacy.dto';
import { updateOwnedDreamPrivacy } from '../services/content/dreamPrivacy.service';

export async function updatePrivacy(req: Request, res: Response): Promise<void> {
  const parsed = parseDreamPrivacyRequest(req.params, req.body);
  if (!parsed.ok) {
    res.status(400).json({ success: false, message: parsed.message });
    return;
  }

  try {
    const dream = await updateOwnedDreamPrivacy({
      ...parsed.value,
      ownerId: req.user!._id as Types.ObjectId,
    });
    if (!dream) {
      res.status(403).json({ success: false, message: 'Not found or access denied.' });
      return;
    }
    res.status(200).json({
      success: true,
      message: 'Privacy updated.',
      data: dream,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update privacy.',
      error,
    });
  }
}
