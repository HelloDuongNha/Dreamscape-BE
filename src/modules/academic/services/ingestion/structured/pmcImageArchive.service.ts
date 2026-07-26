import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fetchUrlWithSafeRedirects } from '../../../infrastructure/security/ssrfGuard';
import { deleteAsset, uploadDocumentImage } from '../../../storage/cloudinaryStorage.service';

export interface PmcArchiveImageResult {
  imageMap: Map<string, string>;
  publicIdByUrl: Map<string, string>;
  uploadedPublicIds: string[];
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  flags: number;
}

const MAX_ENTRIES = 100;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimum = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minimum; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('Gói ảnh PMC không có ZIP central directory hợp lệ.');
}

function listEntries(buffer: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES || centralOffset >= buffer.length) {
    throw new Error('Gói ảnh PMC vượt giới hạn xử lý an toàn.');
  }

  const entries: ZipEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('ZIP entry PMC không hợp lệ.');
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.push({
      name,
      method: buffer.readUInt16LE(offset + 10),
      flags: buffer.readUInt16LE(offset + 8),
      compressedSize: buffer.readUInt32LE(offset + 20),
      uncompressedSize: buffer.readUInt32LE(offset + 24),
      localOffset: buffer.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function extractEntry(archive: Buffer, entry: ZipEntry): Buffer {
  if ((entry.flags & 1) !== 0 || entry.uncompressedSize > MAX_IMAGE_BYTES) {
    throw new Error('ZIP entry PMC bị mã hóa hoặc vượt giới hạn.');
  }
  const offset = entry.localOffset;
  if (offset + 30 > archive.length || archive.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error('ZIP local entry PMC không hợp lệ.');
  }
  const nameLength = archive.readUInt16LE(offset + 26);
  const extraLength = archive.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (start < 0 || end > archive.length) throw new Error('ZIP entry PMC vượt khỏi archive.');
  const compressed = archive.subarray(start, end);
  const output = entry.method === 0
    ? Buffer.from(compressed)
    : entry.method === 8
      ? zlib.inflateRawSync(compressed, { maxOutputLength: MAX_IMAGE_BYTES })
      : (() => { throw new Error('ZIP PMC dùng phương thức nén không hỗ trợ.'); })();
  if (!output.length || output.length !== entry.uncompressedSize) {
    throw new Error('Kích thước ảnh PMC sau giải nén không hợp lệ.');
  }
  return output;
}

function isSupportedImage(name: string, buffer: Buffer): boolean {
  if (!/\.(?:png|jpe?g|gif|webp)$/i.test(name)) return false;
  return (buffer[0] === 0x89 && buffer.subarray(1, 4).toString('ascii') === 'PNG') ||
    (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ||
    ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii')) ||
    (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP');
}

export async function resolvePmcArchiveImages(pmcid: string): Promise<PmcArchiveImageResult> {
  const cleanPmcid = pmcid.toUpperCase().startsWith('PMC') ? pmcid.toUpperCase() : `PMC${pmcid}`;
  const response = await fetchUrlWithSafeRedirects(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/${cleanPmcid}/supplementaryFiles`
  );
  const entries = listEntries(response.buffer);
  const imageMap = new Map<string, string>();
  const publicIdByUrl = new Map<string, string>();
  const uploadedPublicIds: string[] = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmc-images-'));

  try {
    for (const entry of entries) {
      const baseName = path.posix.basename(entry.name);
      if (!baseName || baseName !== entry.name.replace(/\\/g, '/').split('/').pop()) continue;
      let image: Buffer;
      try { image = extractEntry(response.buffer, entry); } catch { continue; }
      if (!isSupportedImage(baseName, image)) continue;

      const extension = path.extname(baseName).toLowerCase();
      const tempPath = path.join(tempDir, `${crypto.randomUUID()}${extension}`);
      fs.writeFileSync(tempPath, image, { mode: 0o600 });
      const uploaded = await uploadDocumentImage(
        tempPath,
        `pmc/${cleanPmcid}/${path.basename(baseName, extension)}-${crypto.randomUUID()}`
      );
      uploadedPublicIds.push(uploaded.public_id);
      publicIdByUrl.set(uploaded.secure_url, uploaded.public_id);
      imageMap.set(baseName.toLowerCase(), uploaded.secure_url);
      imageMap.set(path.basename(baseName, extension).toLowerCase(), uploaded.secure_url);
    }
    return { imageMap, publicIdByUrl, uploadedPublicIds };
  } catch (error) {
    await Promise.all(uploadedPublicIds.map((id) => deleteAsset(id, 'image').catch(() => undefined)));
    throw error;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
