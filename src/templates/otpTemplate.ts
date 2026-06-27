/**
 * Strictly flat HTML template for OTP verification email.
 * Design: Background #101010, 1px solid #262626 container, crisp white typography,
 * large bold centered monospace OTP code. No gradients or shadows.
 */
export const getOtpEmailTemplate = (otpCode: string, purposeLabel: string): string => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DreamScape Verification Code</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #101010;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #f3f5f7;
    }
    .container {
      max-width: 500px;
      margin: 40px auto;
      padding: 32px;
      background-color: #101010;
      border: 1px solid #262626;
      box-sizing: border-box;
    }
    .logo {
      font-size: 24px;
      margin-bottom: 24px;
      text-align: center;
      color: #ffffff;
    }
    .title {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 16px;
      text-align: center;
      color: #ffffff;
    }
    .desc {
      font-size: 14px;
      line-height: 20px;
      margin-bottom: 24px;
      color: #a0a0a0;
      text-align: center;
    }
    .code-box {
      font-family: Menlo, Monaco, Consolas, "Courier New", monospace;
      font-size: 32px;
      font-weight: 700;
      letter-spacing: 6px;
      padding: 20px;
      background-color: #181818;
      border: 1px solid #262626;
      color: #ffffff;
      text-align: center;
      margin: 24px 0;
    }
    .footer {
      font-size: 12px;
      color: #616161;
      text-align: center;
      margin-top: 32px;
      border-top: 1px solid #262626;
      padding-top: 16px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">◈ DreamScape</div>
    <div class="title">Verification Code</div>
    <div class="desc">Please use the following single-use verification code for your <strong>${purposeLabel}</strong> request. This code is valid for 5 minutes.</div>
    <div class="code-box">${otpCode}</div>
    <div class="desc">If you did not make this request, you can safely ignore this email.</div>
    <div class="footer">
      &copy; 2026 DreamScape. All rights reserved.
    </div>
  </div>
</body>
</html>`;
};
