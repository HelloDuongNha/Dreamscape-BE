import cloudinary from '../config/cloudinary';

export interface CloudinaryUploadResult {
  public_id: string;
  secure_url: string;
  resource_type: 'raw' | 'image' | 'video';
  format?: string;
  bytes: number;
  original_filename?: string;
}

/**
 * Uploads a PDF file to Cloudinary using resource_type 'raw' to preserve PDF structure.
 * @param filePath Local path to the temp file
 * @param filename Custom target filename/public_id
 */
export async function uploadPdf(filePath: string, filename: string): Promise<CloudinaryUploadResult> {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      filePath,
      {
        resource_type: 'raw',
        folder: 'academic_sources',
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

