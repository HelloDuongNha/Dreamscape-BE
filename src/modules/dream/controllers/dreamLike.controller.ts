import type { Request, Response } from 'express';
import type { Types } from 'mongoose';
import { parseDreamLikeRequest } from '../dto/dreamLike.dto';
import { toggleDreamLike } from '../services/engagement/dreamLike.service';

export async function toggleLike(req: Request, res: Response): Promise<void> {
  const parsed = parseDreamLikeRequest(req.params);
  if (!parsed.ok) {
    res.status(400).json({ success: false, message: parsed.message });
    return;
  }

  try {
    const result = await toggleDreamLike({
      dreamId: parsed.value.dreamId,
      userId: req.user!._id as Types.ObjectId,
    });
    if (result.status === 'not_found') {
      res.status(404).json({ success: false, message: 'Dream not found.' });
      return;
    }
    if (result.status === 'forbidden') {
      res.status(403).json({
        success: false,
        message: 'Bạn không có quyền xem giấc mơ này.',
      });
      return;
    }

    if (result.notification && result.recipientId) {
      req.app.get('io')?.to(result.recipientId).emit(
        'new_notification',
        result.notification,
      );
    }
    res.status(200).json({
      success: true,
      liked: result.liked,
      likes_count: result.likesCount,
      likes: result.likes,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to toggle like.',
      error,
    });
  }
}
