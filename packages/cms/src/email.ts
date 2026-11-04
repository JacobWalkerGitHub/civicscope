import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

/*
 * Outgoing email for follow alerts. Production sends through Amazon SES from the
 * address in ALERTS_FROM_EMAIL; the site's public address (SITE_URL) goes into every
 * link. Without ALERTS_FROM_EMAIL, production has no email (the Follow buttons are
 * hidden), and development prints each email to the console instead of sending it.
 */

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  /** Adds List-Unsubscribe headers, so mail apps show their own unsubscribe button. */
  unsubscribeUrl?: string;
}

export type EmailSender = (email: OutgoingEmail) => Promise<void>;

export interface AlertsConfig {
  siteUrl: string;
  send: EmailSender;
}

const isProduction = () => process.env.NODE_ENV === 'production';

/** The site's public address with no trailing slash, or null when it isn't known. */
export function siteUrlFromEnv(): string | null {
  const raw = process.env.SITE_URL?.trim();
  if (raw) return raw.replace(/\/+$/, '');
  return isProduction() ? null : 'http://localhost:3000';
}

/** Email settings for follow alerts, or null when email alerts are off here. */
export function alertsConfigFromEnv(): AlertsConfig | null {
  const siteUrl = siteUrlFromEnv();
  if (!siteUrl) return null;
  const from = process.env.ALERTS_FROM_EMAIL?.trim();
  if (from) return { siteUrl, send: sesSender(from) };
  if (isProduction()) return null;
  return { siteUrl, send: consoleSender };
}

const consoleSender: EmailSender = async (email) => {
  console.log(
    `\n--- email to ${email.to} ---\nSubject: ${email.subject}\n\n${email.text}\n--- end ---\n`,
  );
};

let client: SESv2Client | undefined;

export function sesSender(from: string): EmailSender {
  return async (email) => {
    client ??= new SESv2Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: `CivicScope <${from}>`,
        Destination: { ToAddresses: [email.to] },
        Content: {
          Simple: {
            Subject: { Data: email.subject, Charset: 'UTF-8' },
            Body: { Text: { Data: email.text, Charset: 'UTF-8' } },
            Headers: email.unsubscribeUrl
              ? [
                  { Name: 'List-Unsubscribe', Value: `<${email.unsubscribeUrl}>` },
                  // RFC 8058: the mail app POSTs to the link to unsubscribe in one click.
                  { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
                ]
              : undefined,
          },
        },
      }),
    );
  };
}

/** Whether the Follow buttons should show. */
export function alertsEnabled(): boolean {
  return alertsConfigFromEnv() !== null;
}
