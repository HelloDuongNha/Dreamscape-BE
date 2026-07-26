import type { Request, Response } from 'express';
import {
  parseDreamDetailRequest,
  parseDreamPagination,
  parseUserDreamsRequest,
} from '../dto/dreamRead.dto';
import {
  getDreamDetail,
  getPublicDreamPage,
  getUserDreamPage,
} from '../services/content/dreamRead.service';

export async function getPublicFeed(req: Request, res: Response): Promise<void> {
  try {
    const page = await getPublicDreamPage(parseDreamPagination(req.query));
    res.status(200).json({ success: true, ...page });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch feed.', error: err });
  }
}

export async function getUserDreams(req: Request, res: Response): Promise<void> {
  try {
    const parsed = parseUserDreamsRequest(req.params, req.query);
    if (!parsed.ok) {
      res.status(400).json({ success: false, message: parsed.message });
      return;
    }

    const page = await getUserDreamPage(parsed.value);
    res.status(200).json({ success: true, ...page });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch user dreams.', error: err });
  }
}

export async function getDream(req: Request, res: Response): Promise<void> {
  try {
    const parsed = parseDreamDetailRequest(req.params);
    if (!parsed.ok) {
      res.status(400).json({ success: false, message: parsed.message });
      return;
    }

    const dream = await getDreamDetail(parsed.value);
    if (!dream) {
      res.status(404).json({ success: false, message: 'Dream not found.' });
      return;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ success: true, data: dream });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch dream.', error: err });
  }
}
