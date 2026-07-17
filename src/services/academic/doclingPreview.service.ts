import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { DoclingClientService } from './doclingClient.service';
import { DoclingAdapterService } from './doclingAdapter.service';
import { DoclingPreviewSessionService } from './doclingPreviewSession.service';
import { downloadCloudinaryRawAsset } from '../cloudinaryStorage.service';
import SourceContribution from '../../models/SourceContribution';

export interface DoclingPreviewDiagnostics {
  parserEngine: string;
  processingDuration: number;
  ocrUsed: boolean;
  headingCount: number;
  paragraphCount: number;
  tableCount: number;
  figureCount: number;
  referenceCount: number;
  referenceQualityDegraded: boolean;
  detectedPictureCount?: number;
  acceptedFigureCount?: number;
  discardedFurnitureCount?: number;
}

export interface DoclingPreviewResponseDTO {
  success: boolean;
  sessionToken?: string;
  previewBlocks?: any[];
  diagnostics?: DoclingPreviewDiagnostics;
  errorCode?: string;
  errorDetail?: string;
}

export class DoclingPreviewService {
  private static getInputTempBase(): string {
    return process.env.DOCLING_INPUT_TEMP_DIR || os.tmpdir();
  }

  public static async runPreview(
    contributionId: string,
    moderatorId: string
  ): Promise<DoclingPreviewResponseDTO> {
    const contribution = await SourceContribution.findById(contributionId);
    if (!contribution) {
      return {
        success: false,
        errorCode: 'CONTRIBUTION_NOT_FOUND',
        errorDetail: 'Không tìm thấy tài liệu đóng góp.'
      };
    }

    // Resolve Cloudinary Public ID for Original PDF
    const publicId = contribution.originalFile?.cloudinaryPublicId;
    if (!publicId) {
      return {
        success: false,
        errorCode: 'MISSING_ORIGINAL_PDF',
        errorDetail: 'Tài liệu này chưa có tệp PDF gốc được lưu trữ.'
      };
    }

    // 1. Download Cloudinary Raw Asset (handles size and magic bytes validation)
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await downloadCloudinaryRawAsset(publicId);
    } catch (err: any) {
      return {
        success: false,
        errorCode: 'PDF_DOWNLOAD_FAILED',
        errorDetail: err.message || 'Không thể tải PDF từ lưu trữ.'
      };
    }

    // 2. Setup separate Input Temp directory
    const inputTempBase = path.resolve(this.getInputTempBase());
    let inputDir: string;
    try {
      inputDir = fs.mkdtempSync(path.join(inputTempBase, 'preview-input-'));
    } catch {
      return {
        success: false,
        errorCode: 'TEMP_DIR_FAILED',
        errorDetail: 'Không thể tạo thư mục tạm để xử lý PDF.'
      };
    }

    // Containment verification for input dir
    const realInputDir = fs.realpathSync(inputDir);
    const relInput = path.relative(inputTempBase, realInputDir);
    if (!relInput || relInput.startsWith('..') || path.isAbsolute(relInput)) {
      try { fs.rmSync(inputDir, { recursive: true, force: true }); } catch {}
      return {
        success: false,
        errorCode: 'PATH_ESCAPE_DETECTED',
        errorDetail: 'Đường dẫn thư mục tạm không hợp lệ.'
      };
    }

    const tempPdfPath = path.join(realInputDir, 'document.pdf');
    try {
      fs.writeFileSync(tempPdfPath, pdfBuffer, { mode: 0o600 });
    } catch {
      try { fs.rmSync(realInputDir, { recursive: true, force: true }); } catch {}
      return {
        success: false,
        errorCode: 'FILE_WRITE_FAILED',
        errorDetail: 'Không thể ghi tệp tạm để xử lý.'
      };
    }

    let extractionResult: any = null;
    let runCleanup: (() => Promise<void>) | undefined = undefined;
    let clientArtifacts: any[] = [];

    try {
      // 3. Run Docling client parser extraction (timeout 120s managed by Client)
      const run = await DoclingClientService.extractPdf(tempPdfPath, false);
      extractionResult = run.result;
      clientArtifacts = run.artifacts || [];
      runCleanup = run.cleanup;
    } finally {
      // Unconditional cleanup of temporary input directory immediately after extraction
      try {
        if (fs.existsSync(realInputDir)) {
          fs.rmSync(realInputDir, { recursive: true, force: true });
        }
      } catch (e) {
        // Ignore silent cleanup errors
      }
    }

    if (!extractionResult.success) {
      if (runCleanup) await runCleanup().catch(() => {});
      return {
        success: false,
        errorCode: extractionResult.errorCode || 'EXTRACTION_FAILED',
        errorDetail: extractionResult.errorDetail || 'Lỗi phân tích Docling.'
      };
    }

    // 4. Adapt extracted JSON payload to canonical blocks
    const adapterResult = DoclingAdapterService.mapToCanonicalBlocks(
      extractionResult,
      clientArtifacts
    );
    const { canonicalOutput } = adapterResult;

    // 5. Enforce strict limits validation
    const blockLimit = 500;
    const figureLimit = 10;
    const sizeLimit = 20 * 1024 * 1024; // 20 MB

    if (canonicalOutput.blocks.length > blockLimit) {
      if (runCleanup) await runCleanup().catch(() => {});
      return {
        success: false,
        errorCode: 'LIMIT_EXCEEDED',
        errorDetail: `Tài liệu có số lượng block (${canonicalOutput.blocks.length}) vượt quá giới hạn cho phép (${blockLimit}).`
      };
    }

    const acceptedFigureArtifacts = adapterResult.figureArtifacts;
    const acceptedFigureBlocks = canonicalOutput.blocks.filter(b => b.blockType === 'figure');

    if (acceptedFigureBlocks.length > figureLimit) {
      if (runCleanup) await runCleanup().catch(() => {});
      return {
        success: false,
        errorCode: 'LIMIT_EXCEEDED',
        errorDetail: `Tài liệu có số lượng hình ảnh vượt quá giới hạn cho phép (${figureLimit}).`
      };
    }

    // Check size limit of accepted images only
    let totalBytes = 0;
    for (const art of acceptedFigureArtifacts) {
      if (art.filePath && fs.existsSync(art.filePath)) {
        totalBytes += fs.statSync(art.filePath).size;
      }
    }

    if (totalBytes > sizeLimit) {
      if (runCleanup) await runCleanup().catch(() => {});
      return {
        success: false,
        errorCode: 'LIMIT_EXCEEDED',
        errorDetail: `Kích thước hình ảnh trích xuất (${(totalBytes / 1024 / 1024).toFixed(2)} MB) vượt quá giới hạn (${sizeLimit / 1024 / 1024} MB).`
      };
    }

    // 6. Cardinality & ordering reconciliation for figures
    if (acceptedFigureBlocks.length !== acceptedFigureArtifacts.length) {
      if (runCleanup) await runCleanup().catch(() => {});
      return {
        success: false,
        errorCode: 'CARDINALITY_MISMATCH',
        errorDetail: 'Không thể đối chiếu cấu trúc hình ảnh trích xuất với các block.'
      };
    }

    // 7. Map DTO & correlation
    const sessionArtifacts: { previewFigureId: string; filePath: string; format: string }[] = [];

    for (let i = 0; i < acceptedFigureBlocks.length; i++) {
      const block = acceptedFigureBlocks[i];
      const artifact = acceptedFigureArtifacts[i];

      const previewFigureId = crypto.randomUUID();
      block.html = ''; // Set pending figure HTML to non-renderable state

      if (artifact.filePath && artifact.figureType !== 'region_only') {
        block.marker = previewFigureId; // Set preview ID inside block.marker
        sessionArtifacts.push({
          previewFigureId,
          filePath: artifact.filePath,
          format: artifact.format || 'PNG'
        });
      } else {
        block.marker = 'region_only';
      }
    }

    // 8. Zero accepted figures handling: delete raw rejected image files immediately
    let activeCleanup = runCleanup;
    if (acceptedFigureArtifacts.length === 0) {
      if (runCleanup) {
        await runCleanup().catch(() => {});
      }
      activeCleanup = async () => {}; // No-op idempotent callback for session close
    }

    // 9. Setup Ephemeral Session Token
    const sessionToken = crypto.randomBytes(32).toString('hex');
    try {
      await DoclingPreviewSessionService.createSession(
        moderatorId,
        contributionId,
        sessionToken,
        sessionArtifacts,
        activeCleanup || (async () => {})
      );
    } catch (err: any) {
      if (activeCleanup) await activeCleanup().catch(() => {});
      return {
        success: false,
        errorCode: 'SESSION_CREATION_FAILED',
        errorDetail: 'Không thể đăng ký phiên xem thử.'
      };
    }

    // Compute diagnostics
    const headingCount = canonicalOutput.blocks.filter(b => b.blockType === 'heading').length;
    const paragraphCount = canonicalOutput.blocks.filter(b => b.blockType === 'paragraph').length;
    const tableCount = canonicalOutput.blocks.filter(b => b.blockType === 'table').length;
    const figureCount = acceptedFigureBlocks.length;
    const referenceCount = canonicalOutput.blocks.filter(b => b.blockType === 'reference').length;

    const diagnostics: DoclingPreviewDiagnostics = {
      parserEngine: 'docling',
      processingDuration: extractionResult.duration || 0,
      ocrUsed: extractionResult.ocrUsed || false,
      headingCount,
      paragraphCount,
      tableCount,
      figureCount,
      referenceCount,
      referenceQualityDegraded: extractionResult.referenceQualityDegraded || false,
      detectedPictureCount: adapterResult.detectedPictureCount,
      acceptedFigureCount: adapterResult.acceptedFigureCount,
      discardedFurnitureCount: adapterResult.discardedFurnitureCount
    };

    return {
      success: true,
      sessionToken,
      previewBlocks: canonicalOutput.blocks,
      diagnostics
    };
  }
}
