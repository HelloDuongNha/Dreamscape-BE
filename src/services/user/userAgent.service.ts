/**
 * Parses raw User-Agent strings into structured OS and Browser names.
 * Lightweight, dependency-free regex parsing.
 */
export const parseUserAgent = (userAgentString: string): { deviceOS: string; deviceBrowser: string } => {
  let deviceOS = 'Unknown OS';
  let deviceBrowser = 'Unknown Browser';

  if (!userAgentString) {
    return { deviceOS, deviceBrowser };
  }

  // OS detection
  if (/Windows NT/i.test(userAgentString)) {
    if (/Windows NT 10.0/i.test(userAgentString)) deviceOS = 'Windows 10/11';
    else if (/Windows NT 6.3/i.test(userAgentString)) deviceOS = 'Windows 8.1';
    else if (/Windows NT 6.2/i.test(userAgentString)) deviceOS = 'Windows 8';
    else if (/Windows NT 6.1/i.test(userAgentString)) deviceOS = 'Windows 7';
    else deviceOS = 'Windows';
  } else if (/Macintosh/i.test(userAgentString)) {
    const macMatch = userAgentString.match(/Mac OS X (\d+[._]\d+[._]\d+|\d+[._]\d+)/i);
    if (macMatch) {
      deviceOS = `macOS ${macMatch[1].replace(/_/g, '.')}`;
    } else {
      deviceOS = 'macOS';
    }
  } else if (/iPhone|iPad|iPod/i.test(userAgentString)) {
    const iosMatch = userAgentString.match(/OS (\d+[._]\d+[._]\d+|\d+[._]\d+)/i);
    deviceOS = iosMatch ? `iOS ${iosMatch[1].replace(/_/g, '.')}` : 'iOS';
  } else if (/Android/i.test(userAgentString)) {
    const androidMatch = userAgentString.match(/Android (\d+(\.\d+)*)/i);
    deviceOS = androidMatch ? `Android ${androidMatch[1]}` : 'Android';
  } else if (/Linux/i.test(userAgentString)) {
    deviceOS = 'Linux';
  }

  // Browser detection
  if (/Chrome/i.test(userAgentString) && !/Chromium|Edg|OPR|Opera/i.test(userAgentString)) {
    const match = userAgentString.match(/Chrome\/(\d+)/);
    deviceBrowser = match ? `Chrome v${match[1]}` : 'Chrome';
  } else if (/Safari/i.test(userAgentString) && !/Chrome|Chromium|Edg|OPR|Opera/i.test(userAgentString)) {
    const match = userAgentString.match(/Version\/(\d+)/);
    deviceBrowser = match ? `Safari v${match[1]}` : 'Safari';
  } else if (/Firefox/i.test(userAgentString) && !/Seamonkey/i.test(userAgentString)) {
    const match = userAgentString.match(/Firefox\/(\d+)/);
    deviceBrowser = match ? `Firefox v${match[1]}` : 'Firefox';
  } else if (/Edg/i.test(userAgentString)) {
    const match = userAgentString.match(/Edg\/(\d+)/);
    deviceBrowser = match ? `Edge v${match[1]}` : 'Edge';
  } else if (/Opera|OPR/i.test(userAgentString)) {
    deviceBrowser = 'Opera';
  }

  return { deviceOS, deviceBrowser };
};
