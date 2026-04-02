// /home/r_/projects/jeremysayers/src/lib/newsletter/email.ts
export interface NewsletterEmailEnv {
  RESEND_API_KEY?: string;
  NEWSLETTER_FROM_EMAIL?: string;
  NEWSLETTER_REPLY_TO_EMAIL?: string;
  NEWSLETTER_POSTAL_ADDRESS?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSendResult {
  ok: boolean;
  skipped: boolean;
  provider: string;
  messageId?: string;
  error?: string;
}

interface EmailSender {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

class ResendEmailSender implements EmailSender {
  constructor(private readonly env: NewsletterEmailEnv) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (!this.env.RESEND_API_KEY || !this.env.NEWSLETTER_FROM_EMAIL) {
      console.warn('[newsletter] email provider disabled: missing RESEND_API_KEY or NEWSLETTER_FROM_EMAIL');
      return {
        ok: false,
        skipped: true,
        provider: 'resend',
        error: 'missing-credentials'
      };
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: this.env.NEWSLETTER_FROM_EMAIL,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          reply_to: this.env.NEWSLETTER_REPLY_TO_EMAIL || this.env.NEWSLETTER_FROM_EMAIL
        })
      });

      const payload = await response.json() as { id?: string; message?: string };

      if (!response.ok) {
        console.error('[newsletter] resend send failed', {
          status: response.status,
          body: payload
        });
        return {
          ok: false,
          skipped: false,
          provider: 'resend',
          error: payload.message || `http-${response.status}`
        };
      }

      return {
        ok: true,
        skipped: false,
        provider: 'resend',
        messageId: payload.id
      };
    } catch (error) {
      console.error('[newsletter] resend request failed', error);
      return {
        ok: false,
        skipped: false,
        provider: 'resend',
        error: error instanceof Error ? error.message : 'unknown-error'
      };
    }
  }
}

export const createNewsletterEmailSender = (env: NewsletterEmailEnv): EmailSender => {
  return new ResendEmailSender(env);
};

export const buildNewsletterConfirmUrl = (siteUrl: string, token: string) => {
  const url = new URL('/newsletter/confirm/', siteUrl);
  url.searchParams.set('token', token);
  return url.toString();
};

export const buildNewsletterUnsubscribeUrl = (siteUrl: string, token: string) => {
  const url = new URL('/newsletter/unsubscribe/', siteUrl);
  url.searchParams.set('token', token);
  return url.toString();
};

export const renderNewsletterEmailFooter = ({
  unsubscribeUrl,
  postalAddress
}: {
  unsubscribeUrl: string;
  postalAddress?: string;
}) => {
  const mailingAddress = postalAddress || '[Replace with mailing address before production send]';

  return [
    '---',
    'Jeremy Sayers',
    `Unsubscribe: ${unsubscribeUrl}`,
    `Mailing address: ${mailingAddress}`
  ].join('\n');
};

export const renderNewsletterConfirmationEmail = ({
  confirmUrl,
  unsubscribeUrl,
  recipientName,
  postalAddress
}: {
  confirmUrl: string;
  unsubscribeUrl: string;
  recipientName?: string | null;
  postalAddress?: string;
}) => {
  const greeting = recipientName ? `Hi ${recipientName},` : 'Hello,';
  const footer = renderNewsletterEmailFooter({ unsubscribeUrl, postalAddress });

  return {
    subject: 'Confirm your Jeremy Sayers updates subscription',
    text: [
      greeting,
      '',
      'Thanks for signing up for updates from Jeremy Sayers.',
      'Please confirm your subscription by visiting the link below:',
      '',
      confirmUrl,
      '',
      'If you did not request these updates, you can ignore this email.',
      '',
      footer
    ].join('\n')
  };
};
