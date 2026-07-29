import type { Request, Response } from 'express';
import {
  parseDreamDetailRequest,
  parseDreamPagination,
  parseUserDreamsRequest,
} from '../dto/dreamRead.dto';
import { parseDreamSearchRequest } from '../dto/dreamSearch.dto';
import {
  getDreamDetail,
  getPublicDreamPage,
  getUserDreamPage,
} from '../services/content/dreamRead.service';
import { searchAccessibleDreams } from '../services/content/dreamSearch.service';

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

    const page = await getUserDreamPage(parsed.value, String(req.user?._id || '') || undefined);
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

    const dream = await getDreamDetail(parsed.value, String(req.user?._id || '') || undefined);
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

export async function searchDreams(req: Request, res: Response): Promise<void> {
  try {
    const parsed = parseDreamSearchRequest(req.query);
    if (!parsed.ok) {
      res.status(400).json({
        success: false,
        code: parsed.code,
        message: parsed.message,
      });
      return;
    }

    const viewerId = String(req.user?._id ?? '') || undefined;
    const page = await searchAccessibleDreams(parsed.value, viewerId);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ success: true, ...page });
  } catch {
    res.status(500).json({
      success: false,
      code: 'dream_search_failed',
      message: 'Dream search is temporarily unavailable.',
    });
  }
}
