export interface RuleV3DryRunErrorResponse {
  status: number;
  errorCode: string;
  message: string;
}

export function getRuleV3DryRunErrorResponse(error: any): RuleV3DryRunErrorResponse {
  if (error.message === 'provider_timeout' || error.name === 'AbortError') {
    return {
      status: 504,
      errorCode: 'provider_timeout',
      message: 'Yêu cầu trích xuất thử nghiệm quá thời gian chờ (timeout).',
    };
  }
  if (error.message === 'provider_schema_invalid') {
    return {
      status: 422,
      errorCode: 'provider_schema_invalid',
      message: 'Phản hồi từ mô hình không khớp với cấu trúc schema yêu cầu.',
    };
  }
  if (error.message === 'input_too_large') {
    return {
      status: 413,
      errorCode: 'input_too_large',
      message: 'Dữ liệu đầu vào quá lớn (vượt quá 50,000 ký tự).',
    };
  }
  if (error.message === 'work_unit_not_found') {
    return {
      status: 404,
      errorCode: 'work_unit_not_found',
      message: 'Không tìm thấy đơn vị xử lý thông tin được chọn.',
    };
  }
  if (error.message === 'invalid_provider') {
    return {
      status: 400,
      errorCode: 'invalid_provider',
      message: 'Dịch vụ AI được chọn không hợp lệ hoặc không khả dụng.',
    };
  }
  return {
    status: 400,
    errorCode: 'provider_unavailable',
    message: 'Không thể kết nối dịch vụ hoặc cấu hình không hợp lệ.',
  };
}
