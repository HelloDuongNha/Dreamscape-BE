import type { Request, Response } from 'express';
import type { Types } from 'mongoose';
import { parseDeleteDreamRequest } from '../dto/dreamDelete.dto';
import { deleteOwnedDream } from '../services/content/dreamDelete.service';

export async function deleteDream(req: Request, res: Response): Promise<void> {
  const parsed = parseDeleteDreamRequest(req.params);
  if (!parsed.ok) {
    res.status(400).json({ success: false, message: parsed.message });
    return;
  }

  try {
    const deleted = await deleteOwnedDream({
      dreamId: parsed.value.dreamId,
      ownerId: req.user!._id as Types.ObjectId,
    });
    if (!deleted) {
      res.status(403).json({ success: false, message: 'Not found or access denied.' });
      return;
    }
    res.status(200).json({ success: true, message: 'Dream deleted.' });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete dream.',
      error,
    });
  }
}
