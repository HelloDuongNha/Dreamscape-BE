import cloudinary from '../../config/cloudinary';
import {
  PDF_DOWNLOAD_TIMEOUT_MS,
  PDF_MAX_FILE_SIZE_BYTES,
  PDF_MAX_FILE_SIZE_LABEL,
} from '../../config/pdfLimits';

export interface CloudinaryUploadResult {
  public_id: string;
  secure_url: string;
  resource_type: 'raw' | 'image' | 'video';
  format?: string;
  bytes: number;
  original_filename?: string;
}

/**
 * Uploads an extracted image or figure to Cloudinary.
 * @param filePath Local path to the image
 * @param filename Custom target public_id
 */
export async function uploadDocumentImage(filePath: string, filename: string): Promise<CloudinaryUploadResult> {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      filePath,
      {
        resource_type: 'image',
        folder: 'academic_assets',
        public_id: filename,
        use_filename: true,
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else if (!result) {
          reject(new Error('Cloudinary returned empty response'));
        } else {
          resolve({
            public_id: result.public_id,
            secure_url: result.secure_url,
            resource_type: result.resource_type as any,
            format: result.format,
            bytes: result.bytes,
            original_filename: result.original_filename,
          });
        }
      }
    );
  });
}

/**
 * Deletes an asset from Cloudinary using its public_id.
 * @param publicId Public ID of the asset
 * @param resourceType Resource type of the asset ('raw', 'image', etc.)
 */
export async function deleteAsset(publicId: string, resourceType: string = 'raw'): Promise<any> {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.destroy(
      publicId,
      {
        resource_type: resourceType,
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );
  });
}

/**
 * Fetches asset resource details directly from Cloudinary server-side.
 * Used to verify the existence, size, and format of client-provided references.
 */
export async function getAssetMetadata(publicId: string, resourceType: string = 'raw'): Promise<any> {
  return new Promise((resolve, reject) => {
    cloudinary.api.resource(
      publicId,
      {
        resource_type: resourceType,
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );
  });
}

/**
 * Downloads a raw asset stored in Cloudinary server-side using a signed download URL.
 * Validates that the downloaded file is a non-empty PDF within the configured limit.
 */
export async function downloadCloudinaryRawAsset(publicId: string, resourceType: string = 'raw'): Promise<Buffer> {
  if (!publicId) {
    throw new Error('Thiếu Cloudinary public ID để tải tài liệu.');
  }

  // Generate private signed URL using Cloudinary SDK
  const signedUrl = cloudinary.utils.private_download_url(publicId, '', {
    resource_type: resourceType,
    type: 'upload'
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PDF_DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(signedUrl, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`Máy chủ tài liệu trả về mã lỗi: ${response.status}`);
    }

    // Size validation - check Content-Length before reading when available
    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader) {
      const size = parseInt(contentLengthHeader, 10);
      if (size > PDF_MAX_FILE_SIZE_BYTES) {
        throw new Error(`Kích thước tệp vượt quá giới hạn cho phép (${PDF_MAX_FILE_SIZE_LABEL}).`);
      }
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Final buffer length check
    if (!buffer || buffer.length === 0) {
      throw new Error('Tải tệp từ Cloudinary không có dữ liệu.');
    }

    if (buffer.length > PDF_MAX_FILE_SIZE_BYTES) {
      throw new Error(`Kích thước tệp thực tế vượt quá giới hạn cho phép (${PDF_MAX_FILE_SIZE_LABEL}).`);
    }

    // Validate PDF magic bytes (%PDF)
    if (buffer.length < 4 || buffer.toString('utf8', 0, 4) !== '%PDF') {
      throw new Error('Tệp tải xuống không phải là định dạng PDF hợp lệ.');
    }

    return buffer;

  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Quá thời gian kết nối khi tải tệp tài liệu.');
    }
    const safeMessage = err.message || 'Lỗi không xác định khi tải tệp từ lưu trữ.';
    throw new Error(safeMessage.replace(/https:\/\/[^\s]+/g, '[REDACTED_URL]'));
  } finally {
    clearTimeout(timeoutId);
  }
}
