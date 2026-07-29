export type RuleV3ProviderName = 'ollama' | 'gemini';

export type RuleV3BulkAction =
  | 'approve_pending'
  | 'reject_pending'
  | 'restore_rejected'
  | 'delete_rejected';

export interface RuleV3ExtractionRequest {
  provider?: RuleV3ProviderName | string;
  replaceExisting: boolean;
}

export interface RuleV3BulkActionRequest {
  action: RuleV3BulkAction | '';
  confirmation: string;
  sourceId?: string;
}

export interface RuleV3CandidateQuery {
  status: string;
  sourceId: string | null;
  nameQuery: string;
  validationError: 'name_query_too_long' | null;
}

/** Đọc request trích xuất mà không thay đổi giá trị mặc định hiện có. */
export function parseRuleV3ExtractionRequest(body: unknown): RuleV3ExtractionRequest {
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const provider = input.provider === undefined || input.provider === null || input.provider === ''
    ? undefined
    : String(input.provider);
  return {
    provider,
    replaceExisting: input.replaceExisting === true,
  };
}

/** Chuẩn hóa thao tác hàng loạt trước khi controller kiểm tra quyền thực thi. */
export function parseRuleV3BulkActionRequest(body: unknown): RuleV3BulkActionRequest {
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const rawAction = String(input.action || '');
  const action: RuleV3BulkActionRequest['action'] =
    rawAction === 'approve_pending'
      || rawAction === 'reject_pending'
      || rawAction === 'restore_rejected'
      || rawAction === 'delete_rejected'
      ? rawAction
      : '';
  const rawSourceId = input.sourceId ? String(input.sourceId) : undefined;
  return {
    action,
    confirmation: input.confirmation as string || '',
    sourceId: rawSourceId,
  };
}

/** Chuẩn hóa bộ lọc danh sách ứng viên trước khi tạo truy vấn MongoDB. */
export function parseRuleV3CandidateQuery(query: unknown): RuleV3CandidateQuery {
  const input = query && typeof query === 'object' ? query as Record<string, unknown> : {};
  const nameQuery = String(input.q || '').trim().replace(/\s+/gu, ' ');
  return {
    status: String(input.status || 'pending'),
    sourceId: input.academicSourceId ? String(input.academicSourceId) : null,
    nameQuery,
    validationError: nameQuery.length > 120 ? 'name_query_too_long' : null,
  };
}

/** Build a literal, case-insensitive label matcher without allowing regex input. */
export function buildRuleV3NameRegex(nameQuery: string): RegExp {
  const pattern = nameQuery
    .split(' ')
    .map(token => token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
    .join('\\s+');
  return new RegExp(pattern, 'iu');
}
