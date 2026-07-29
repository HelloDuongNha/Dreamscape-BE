import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deliverOtpEmail,
  resolveEmailTransportConfig,
} from '../../src/infrastructure/emailService';
import { sanitizeLogText, sanitizeLogValue } from '../../src/infrastructure/logSanitizer';

test('log sanitization removes nested credentials, OTPs, and URL tokens', () => {
  const sanitized = sanitizeLogValue({
    userId: 'user-1',
    password: 'plain-password',
    content: 'private message body',
    encryptionKey: 'private-key-material',
    nested: {
      authorization: 'Bearer abc.def.ghi',
      note: 'OTP 123456 failed at /verify?token=secret-token',
    },
  });

  assert.deepEqual(sanitized, {
    userId: 'user-1',
    password: '[REDACTED]',
    content: '[REDACTED]',
    encryptionKey: '[REDACTED]',
    nested: {
      authorization: '[REDACTED]',
      note: 'OTP [REDACTED] failed at /verify?token=[REDACTED]',
    },
  });
  assert.equal(
    sanitizeLogText('Authorization: Bearer abc.def.ghi'),
    'Authorization: Bearer [REDACTED]',
  );
});

test('SMTP config rejects missing credentials and never supplies secret defaults', () => {
  const originalUser = process.env.SMTP_USER;
  const originalPassword = process.env.SMTP_PASS;
  const originalPort = process.env.SMTP_PORT;

  try {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    assert.throws(resolveEmailTransportConfig, /SMTP credentials are not configured/);

    process.env.SMTP_USER = 'mailer@example.test';
    process.env.SMTP_PASS = 'configured-by-secret-manager';
    process.env.SMTP_PORT = '465';
    const config = resolveEmailTransportConfig();
    assert.equal(config.user, 'mailer@example.test');
    assert.equal(config.password, 'configured-by-secret-manager');
    assert.equal(config.secure, true);
    assert.equal(config.from, '"DreamScape" <mailer@example.test>');
  } finally {
    restoreEnvironmentValue('SMTP_USER', originalUser);
    restoreEnvironmentValue('SMTP_PASS', originalPassword);
    restoreEnvironmentValue('SMTP_PORT', originalPort);
  }
});

test('OTP delivery passes the code only to the mail body and never to captured logs', async () => {
  const sentMessages: unknown[] = [];
  const capturedLogs: string[] = [];
  const originalConsoleLog = console.log;
  console.log = (...values: unknown[]) => {
    capturedLogs.push(values.map(String).join(' '));
  };

  try {
    await deliverOtpEmail(
      {
        email: 'recipient@example.test',
        otpCode: '654321',
        purpose: 'forgot_password',
        from: '"DreamScape" <mailer@example.test>',
      },
      {
        async sendMail(message) {
          sentMessages.push(message);
        },
      },
    );
  } finally {
    console.log = originalConsoleLog;
  }

  assert.equal(sentMessages.length, 1);
  const message = sentMessages[0] as { html?: string; subject?: string };
  assert.match(message.html || '', /654321/);
  assert.doesNotMatch(message.subject || '', /654321/);
  assert.equal(capturedLogs.some((entry) => entry.includes('654321')), false);
  assert.equal(capturedLogs.some((entry) => entry.includes('recipient@example.test')), false);
});

function restoreEnvironmentValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
