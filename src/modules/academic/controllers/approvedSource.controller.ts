import type { Request, Response } from 'express';
import {
  parseApprovedSourceCatalogQuery,
  parseApprovedSourceId,
} from '../dto/approvedSource.dto';
import {
  findApprovedSourceDetail,
  listApprovedSources,
} from '../services/source/approvedSourceCatalog.service';

export async function getApprovedSources(req: Request, res: Response): Promise<void> {
  try {
    const data = await listApprovedSources(parseApprovedSourceCatalogQuery(req.query));
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching approved academic sources.',
      error: error.message || error,
    });
  }
}

export async function getApprovedSourceById(req: Request, res: Response): Promise<void> {
  try {
    const id = parseApprovedSourceId(req.params.id);
    if (!id) {
      res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
      return;
    }

    const source = await findApprovedSourceDetail(id);
    if (!source) {
      res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
      return;
    }

    res.status(200).json({ success: true, data: source });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi lấy thông tin chi tiết tài liệu.',
      error: error.message || error,
    });
  }
}
