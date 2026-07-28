import { Types } from 'mongoose';

export interface DreamFeedbackDto {
  dreamId: string;
  hypothesisIndex?: number;
  verificationKey?: string;
  answer: 'yes' | 'no' | 'unsure' | null;
}

export function parseDreamFeedbackRequest(
  params: Record<string, unknown>,
  body: unknown,
):
  | { ok: true; value: DreamFeedbackDto }
  | { ok: false; status: 400; message: string } {
  const dreamId = String(params.id || '');
  if (!Types.ObjectId.isValid(dreamId)) {
    return { ok: false, status: 400, message: 'ID giấc mơ không hợp lệ.' };
  }

  const input = body && typeof body === 'object'
    ? body as Record<string, unknown>
    : {};
  const hypothesisIndex = input.hypothesisIndex;
  const hasValidIndex = typeof hypothesisIndex === 'number'
    && Number.isInteger(hypothesisIndex)
    && hypothesisIndex >= 0;
  const verificationKey = String(input.verificationKey || '').trim();
  if (!hasValidIndex && !verificationKey) {
    return { ok: false, status: 400, message: 'Thiếu mã câu hỏi hợp lệ.' };
  }

  const answer = input.answer;
  if (answer !== null && answer !== 'yes' && answer !== 'no' && answer !== 'unsure') {
    return { ok: false, status: 400, message: 'Câu trả lời không hợp lệ.' };
  }
  return {
    ok: true,
    value: {
      dreamId,
      ...(hasValidIndex ? { hypothesisIndex } : {}),
      ...(verificationKey ? { verificationKey } : {}),
      answer,
    },
  };
}
