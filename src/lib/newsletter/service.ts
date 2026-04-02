// /home/r_/projects/jeremysayers/src/lib/newsletter/service.ts
import {
  buildNewsletterConfirmUrl,
  buildNewsletterUnsubscribeUrl,
  createNewsletterEmailSender,
  renderNewsletterConfirmationEmail,
  type NewsletterEmailEnv
} from './email';

export type NewsletterStatus = 'pending' | 'active' | 'unsubscribed' | 'bounced' | 'complained';

export interface NewsletterServiceEnv extends NewsletterEmailEnv {
  DB_JEREMYSAYERS?: D1Database;
  NEWSLETTER_IP_HASH_SALT?: string;
}

interface SubscriberRecord {
  id: number;
  email: string;
  email_normalized: string;
  first_name: string | null;
  last_name: string | null;
  interests: string | null;
  status: NewsletterStatus;
  source_page: string | null;
  signup_ip_hash: string | null;
  signup_user_agent: string | null;
  created_at: string;
  confirm_token: string | null;
  confirm_token_expires_at: string | null;
  confirmed_at: string | null;
  unsubscribe_token: string | null;
  unsubscribe_at: string | null;
  suppressed_reason: string | null;
  last_email_sent_at: string | null;
}

export type SignupOutcome = 'pending_confirmation' | 'already_active' | 'suppressed';
export type ConfirmOutcome = 'confirmed' | 'expired' | 'invalid';
export type UnsubscribeOutcome = 'unsubscribed' | 'invalid';

const CONFIRM_TOKEN_TTL_HOURS = 72;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const newsletterLog = (event: string, data?: Record<string, unknown>) => {
  console.log(`[newsletter] ${event}`, data ?? {});
};

const getNewsletterDb = (env: NewsletterServiceEnv) => {
  if (!env.DB_JEREMYSAYERS) {
    throw new Error('missing-db-binding');
  }
  return env.DB_JEREMYSAYERS;
};

export const normalizeNewsletterOptional = (value: FormDataEntryValue | null, maxLength: number) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
};

export const normalizeNewsletterRequired = (value: FormDataEntryValue | null, maxLength: number) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
};

export const resolveNewsletterRedirectPath = (candidate: string | null, fallback = '/') => {
  if (!candidate || typeof candidate !== 'string') return fallback;
  if (!candidate.startsWith('/')) return fallback;
  return candidate.length > 200 ? fallback : candidate;
};

export const isValidNewsletterEmail = (email: string) => EMAIL_REGEX.test(email);

export const normalizeNewsletterEmail = (email: string) => email.trim().toLowerCase();

const createSecureToken = (bytes = 32) => {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(tokenBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const addHours = (date: Date, hours: number) => new Date(date.getTime() + hours * 60 * 60 * 1000);

const toIsoString = (date: Date) => date.toISOString();

const hashIpAddress = async (ip: string | null, salt?: string) => {
  if (!ip) return null;
  const input = `${salt || 'jeremysayers-newsletter'}:${ip}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const findSubscriberByNormalizedEmail = async (db: D1Database, emailNormalized: string) => {
  return db
    .prepare('SELECT * FROM newsletter_subscribers WHERE email_normalized = ?1 LIMIT 1')
    .bind(emailNormalized)
    .first<SubscriberRecord>();
};

const findSubscriberByConfirmToken = async (db: D1Database, token: string) => {
  return db
    .prepare('SELECT * FROM newsletter_subscribers WHERE confirm_token = ?1 LIMIT 1')
    .bind(token)
    .first<SubscriberRecord>();
};

const findSubscriberByUnsubscribeToken = async (db: D1Database, token: string) => {
  return db
    .prepare('SELECT * FROM newsletter_subscribers WHERE unsubscribe_token = ?1 LIMIT 1')
    .bind(token)
    .first<SubscriberRecord>();
};

const updateLastEmailSentAt = async (db: D1Database, subscriberId: number, sentAt: string) => {
  await db
    .prepare('UPDATE newsletter_subscribers SET last_email_sent_at = ?1 WHERE id = ?2')
    .bind(sentAt, subscriberId)
    .run();
};

const sendConfirmationEmail = async ({
  env,
  subscriber,
  siteUrl
}: {
  env: NewsletterServiceEnv;
  subscriber: SubscriberRecord;
  siteUrl: string;
}) => {
  if (!subscriber.confirm_token || !subscriber.unsubscribe_token) {
    newsletterLog('confirmation_email_skipped_missing_tokens', {
      subscriberId: subscriber.id
    });
    return;
  }

  const sender = createNewsletterEmailSender(env);
  const confirmUrl = buildNewsletterConfirmUrl(siteUrl, subscriber.confirm_token);
  const unsubscribeUrl = buildNewsletterUnsubscribeUrl(siteUrl, subscriber.unsubscribe_token);
  const email = renderNewsletterConfirmationEmail({
    confirmUrl,
    unsubscribeUrl,
    recipientName: subscriber.first_name,
    postalAddress: env.NEWSLETTER_POSTAL_ADDRESS
  });

  const result = await sender.send({
    to: subscriber.email_normalized,
    subject: email.subject,
    text: email.text
  });

  if (result.ok) {
    await updateLastEmailSentAt(getNewsletterDb(env), subscriber.id, toIsoString(new Date()));
    newsletterLog('confirmation_sent', {
      subscriberId: subscriber.id,
      provider: result.provider,
      messageId: result.messageId ?? null
    });
    return;
  }

  if (result.skipped) {
    newsletterLog('confirmation_send_skipped', {
      subscriberId: subscriber.id,
      provider: result.provider,
      error: result.error ?? null
    });
    return;
  }

  newsletterLog('confirmation_send_failed', {
    subscriberId: subscriber.id,
    provider: result.provider,
    error: result.error ?? null
  });
};

const hydratePendingSubscriber = async ({
  db,
  subscriberId,
  email,
  firstName,
  lastName,
  interests,
  sourcePage,
  signupIpHash,
  signupUserAgent,
  confirmToken,
  confirmTokenExpiresAt,
  unsubscribeToken
}: {
  db: D1Database;
  subscriberId: number;
  email: string;
  firstName: string;
  lastName: string | null;
  interests: string | null;
  sourcePage: string | null;
  signupIpHash: string | null;
  signupUserAgent: string | null;
  confirmToken: string;
  confirmTokenExpiresAt: string;
  unsubscribeToken: string;
}) => {
  await db
    .prepare(
      `UPDATE newsletter_subscribers
       SET email = ?1,
           email_normalized = ?2,
           first_name = ?3,
           last_name = ?4,
           interests = ?5,
           status = 'pending',
           source_page = ?6,
           signup_ip_hash = ?7,
           signup_user_agent = ?8,
           confirm_token = ?9,
           confirm_token_expires_at = ?10,
           unsubscribe_token = COALESCE(unsubscribe_token, ?11),
           unsubscribe_at = NULL,
           suppressed_reason = NULL
       WHERE id = ?12`
    )
    .bind(
      email,
      email,
      firstName,
      lastName,
      interests,
      sourcePage,
      signupIpHash,
      signupUserAgent,
      confirmToken,
      confirmTokenExpiresAt,
      unsubscribeToken,
      subscriberId
    )
    .run();

  return db
    .prepare('SELECT * FROM newsletter_subscribers WHERE id = ?1 LIMIT 1')
    .bind(subscriberId)
    .first<SubscriberRecord>();
};

export const submitNewsletterSignup = async ({
  env,
  firstName,
  lastName,
  email,
  interests,
  sourcePage,
  sourceContext,
  siteUrl,
  remoteIp,
  userAgent
}: {
  env: NewsletterServiceEnv;
  firstName: string;
  lastName: string | null;
  email: string;
  interests: string | null;
  sourcePage: string | null;
  sourceContext: string | null;
  siteUrl: string;
  remoteIp: string | null;
  userAgent: string | null;
}): Promise<SignupOutcome> => {
  const db = getNewsletterDb(env);
  const now = new Date();
  const emailNormalized = normalizeNewsletterEmail(email);
  const confirmToken = createSecureToken();
  const unsubscribeToken = createSecureToken();
  const confirmTokenExpiresAt = toIsoString(addHours(now, CONFIRM_TOKEN_TTL_HOURS));
  const signupIpHash = await hashIpAddress(remoteIp, env.NEWSLETTER_IP_HASH_SALT);
  const signupUserAgent = userAgent?.slice(0, 500) || null;
  const existing = await findSubscriberByNormalizedEmail(db, emailNormalized);

  newsletterLog('signup_received', {
    email: emailNormalized,
    sourcePage,
    sourceContext
  });

  if (!existing) {
    const createdAt = toIsoString(now);
    await db
      .prepare(
        `INSERT INTO newsletter_subscribers (
          email,
          email_normalized,
          first_name,
          last_name,
          interests,
          status,
          source_page,
          signup_ip_hash,
          signup_user_agent,
          created_at,
          confirm_token,
          confirm_token_expires_at,
          unsubscribe_token
        )
        VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
      )
      .bind(
        emailNormalized,
        emailNormalized,
        firstName,
        lastName,
        interests,
        sourcePage,
        signupIpHash,
        signupUserAgent,
        createdAt,
        confirmToken,
        confirmTokenExpiresAt,
        unsubscribeToken
      )
      .run();

    const createdSubscriber = await findSubscriberByNormalizedEmail(db, emailNormalized);
    if (!createdSubscriber) {
      throw new Error('subscriber-create-failed');
    }

    newsletterLog('signup_created', {
      subscriberId: createdSubscriber.id,
      email: emailNormalized
    });

    await sendConfirmationEmail({
      env,
      subscriber: createdSubscriber,
      siteUrl
    });
    return 'pending_confirmation';
  }

  if (existing.status === 'active') {
    if (!existing.unsubscribe_token) {
      await db
        .prepare('UPDATE newsletter_subscribers SET unsubscribe_token = ?1 WHERE id = ?2')
        .bind(unsubscribeToken, existing.id)
        .run();
    }
    newsletterLog('signup_existing_active', {
      subscriberId: existing.id,
      email: emailNormalized
    });
    return 'already_active';
  }

  if (existing.status === 'unsubscribed' || existing.status === 'bounced' || existing.status === 'complained') {
    newsletterLog('signup_suppressed', {
      subscriberId: existing.id,
      email: emailNormalized,
      status: existing.status
    });
    return 'suppressed';
  }

  const refreshedSubscriber = await hydratePendingSubscriber({
    db,
    subscriberId: existing.id,
    email: emailNormalized,
    firstName,
    lastName,
    interests,
    sourcePage,
    signupIpHash,
    signupUserAgent,
    confirmToken,
    confirmTokenExpiresAt,
    unsubscribeToken
  });

  if (!refreshedSubscriber) {
    throw new Error('subscriber-refresh-failed');
  }

  newsletterLog('signup_pending_refreshed', {
    subscriberId: refreshedSubscriber.id,
    email: emailNormalized
  });

  await sendConfirmationEmail({
    env,
    subscriber: refreshedSubscriber,
    siteUrl
  });
  return 'pending_confirmation';
};

export const confirmNewsletterSubscription = async ({
  env,
  token
}: {
  env: NewsletterServiceEnv;
  token: string;
}): Promise<{ outcome: ConfirmOutcome; email?: string | null }> => {
  const db = getNewsletterDb(env);
  const subscriber = await findSubscriberByConfirmToken(db, token);

  if (!subscriber || subscriber.status !== 'pending') {
    return { outcome: 'invalid' };
  }

  if (!subscriber.confirm_token_expires_at || Date.parse(subscriber.confirm_token_expires_at) < Date.now()) {
    newsletterLog('confirmation_expired', {
      subscriberId: subscriber.id
    });
    return {
      outcome: 'expired',
      email: subscriber.email_normalized
    };
  }

  const confirmedAt = toIsoString(new Date());
  const unsubscribeToken = subscriber.unsubscribe_token || createSecureToken();

  await db
    .prepare(
      `UPDATE newsletter_subscribers
       SET status = 'active',
           confirmed_at = ?1,
           confirm_token = NULL,
           confirm_token_expires_at = NULL,
           unsubscribe_token = ?2,
           suppressed_reason = NULL
       WHERE id = ?3`
    )
    .bind(confirmedAt, unsubscribeToken, subscriber.id)
    .run();

  newsletterLog('confirmed', {
    subscriberId: subscriber.id
  });

  return {
    outcome: 'confirmed',
    email: subscriber.email_normalized
  };
};

export const resendNewsletterConfirmation = async ({
  env,
  email,
  siteUrl
}: {
  env: NewsletterServiceEnv;
  email: string;
  siteUrl: string;
}) => {
  const db = getNewsletterDb(env);
  const emailNormalized = normalizeNewsletterEmail(email);
  const subscriber = await findSubscriberByNormalizedEmail(db, emailNormalized);

  if (!subscriber || subscriber.status !== 'pending') {
    newsletterLog('resend_confirmation_ignored', {
      email: emailNormalized,
      found: Boolean(subscriber),
      status: subscriber?.status ?? null
    });
    return;
  }

  const confirmToken = createSecureToken();
  const confirmTokenExpiresAt = toIsoString(addHours(new Date(), CONFIRM_TOKEN_TTL_HOURS));

  await db
    .prepare(
      `UPDATE newsletter_subscribers
       SET confirm_token = ?1,
           confirm_token_expires_at = ?2
       WHERE id = ?3`
    )
    .bind(confirmToken, confirmTokenExpiresAt, subscriber.id)
    .run();

  const refreshedSubscriber = await db
    .prepare('SELECT * FROM newsletter_subscribers WHERE id = ?1 LIMIT 1')
    .bind(subscriber.id)
    .first<SubscriberRecord>();

  if (!refreshedSubscriber) {
    return;
  }

  await sendConfirmationEmail({
    env,
    subscriber: refreshedSubscriber,
    siteUrl
  });
};

export const unsubscribeNewsletterSubscription = async ({
  env,
  token
}: {
  env: NewsletterServiceEnv;
  token: string;
}): Promise<{ outcome: UnsubscribeOutcome; email?: string | null }> => {
  const db = getNewsletterDb(env);
  const subscriber = await findSubscriberByUnsubscribeToken(db, token);

  if (!subscriber) {
    return { outcome: 'invalid' };
  }

  const unsubscribedAt = toIsoString(new Date());

  await db
    .prepare(
      `UPDATE newsletter_subscribers
       SET status = 'unsubscribed',
           unsubscribe_at = ?1,
           unsubscribe_token = NULL,
           confirm_token = NULL,
           confirm_token_expires_at = NULL,
           suppressed_reason = 'user_unsubscribed'
       WHERE id = ?2`
    )
    .bind(unsubscribedAt, subscriber.id)
    .run();

  newsletterLog('unsubscribed', {
    subscriberId: subscriber.id
  });

  return {
    outcome: 'unsubscribed',
    email: subscriber.email_normalized
  };
};

export const isNewsletterRecipientSendable = (status: NewsletterStatus) => status === 'active';
