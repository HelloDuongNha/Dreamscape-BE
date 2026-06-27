import dns from 'dns';
import { URL } from 'url';

export class SsrfError extends Error {
  attemptedUrl: string;
  finalUrl: string;
  constructor(message: string, attemptedUrl: string, finalUrl: string) {
    super(message);
    this.name = 'SsrfError';
    this.attemptedUrl = attemptedUrl;
    this.finalUrl = finalUrl;
  }
}

function isPrivateIp(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '0.0.0.0' || ip === '::1' || ip === '::') {
    return true;
  }
  if (/^10\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  return false;
}

export async function isUrlSafe(urlString: string): Promise<boolean> {
  try {
    const parsedUrl = new URL(urlString);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return false;
    }
    
    const hostname = parsedUrl.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '127.0.0.1' || /^169\.254\./.test(hostname)) {
      return false;
    }

    try {
      const addresses = await dns.promises.lookup(parsedUrl.hostname, { all: true });
      for (const addr of addresses) {
        if (isPrivateIp(addr.address)) {
          return false;
        }
      }
    } catch {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function isValidHttpUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function fetchUrlWithSafeRedirects(
  initialUrl: string,
  requirePdf = false,
  maxRedirects = 3
): Promise<{ buffer: Buffer, finalUrl: string, contentType: string }> {
  let currentUrl = initialUrl;
  let redirectCount = 0;

  while (true) {
    const safe = await isUrlSafe(currentUrl);
    if (!safe) {
      console.warn(`SSRF Blocked: Attempted URL = ${initialUrl}, Current Redirect URL = ${currentUrl}`);
      throw new SsrfError(
        'SSRF: Đích đến URL không an toàn hoặc nằm trong dải IP nội bộ.',
        initialUrl,
        currentUrl
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15-second timeout

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent': 'DreamScapeAcademicBot/1.0 (mailto:dreamscape.app.service@gmail.com)'
        },
        signal: controller.signal
      });
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error('Hết thời gian kết nối tới máy chủ tài liệu (15s).');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error('Nhận được phản hồi chuyển hướng nhưng thiếu Header Location.');
      }

      const resolvedUrl = new URL(location, currentUrl).toString();
      
      redirectCount++;
      if (redirectCount > maxRedirects) {
        throw new Error('Quá số lần chuyển hướng cho phép (Max: 3).');
      }

      currentUrl = resolvedUrl;
      continue;
    }

    if (!response.ok) {
      throw new Error(`Máy chủ tài liệu trả về mã lỗi: ${response.status}`);
    }

    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader) {
      const size = parseInt(contentLengthHeader, 10);
      if (size > 15 * 1024 * 1024) {
        throw new Error('Kích thước tệp vượt quá giới hạn cho phép (15MB).');
      }
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > 15 * 1024 * 1024) {
      throw new Error('Kích thước tệp thực tế vượt quá giới hạn cho phép (15MB).');
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();

    if (requirePdf) {
      const urlPath = new URL(currentUrl).pathname.toLowerCase();
      const hasPdfSignature = buffer.length >= 4 && buffer.toString('ascii', 0, 4) === '%PDF';
      const isPdf = contentType.includes('application/pdf') || urlPath.endsWith('.pdf') || hasPdfSignature;

      if (!isPdf) {
        throw new Error('Tệp không phải PDF hợp lệ.');
      }
    }

    return { buffer, finalUrl: currentUrl, contentType };
  }
}
