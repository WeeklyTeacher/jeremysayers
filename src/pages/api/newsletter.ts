// /home/r_/projects/jeremysayers/src/pages/api/newsletter.ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEBUG = import.meta.env.DEV;

const normalizeOptional = (value: FormDataEntryValue | null, maxLength: number) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
};

const normalizeRequired = (value: FormDataEntryValue | null, maxLength: number) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
};

const resolveRedirectPath = (candidate: string | null, fallback = '/') => {
  if (!candidate || typeof candidate !== 'string') return fallback;
  if (!candidate.startsWith('/')) return fallback;
  return candidate.length > 200 ? fallback : candidate;
};

type SignupStatus =
  | 'success'
  | 'duplicate'
  | 'missing-email'
  | 'invalid-email'
  | 'missing-first-name'
  | 'bad-method'
  | 'bad-request'
  | 'db-error'
  | 'unknown-error';

const appendStatus = (path: string, status: SignupStatus) => {
  const url = new URL(path, 'http://localhost');
  url.searchParams.set('newsletter', status);
  return `${url.pathname}${url.search}`;
};

const logStep = (step: string, data?: Record<string, unknown>) => {
  if (!DEBUG) return;
  console.log(`[newsletter] ${step}`, data ?? {});
};

const readNewsletterTablePresence = async (newsletterDb: D1Database) => {
  return newsletterDb
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1")
    .bind('newsletter_subscribers')
    .first<{ name: string }>();
};

export const POST: APIRoute = async ({ request, redirect }) => {
  let sourcePage = '/';

  const redirectWithStatus = (status: SignupStatus) => {
    const target = appendStatus(sourcePage, status);
    console.log('[newsletter] redirecting', { status, target });
    return redirect(target, 303);
  };

  try {
    logStep('request_received', {
      method: request.method,
      contentType: request.headers.get('content-type'),
      cfConnectingIp: request.headers.get('CF-Connecting-IP'),
      host: request.headers.get('host'),
      origin: request.headers.get('origin'),
      referer: request.headers.get('referer'),
    });

    const formData = await request.formData();

    const firstName = normalizeRequired(formData.get('firstName'), 120);
    const lastName = normalizeOptional(formData.get('lastName'), 120);
    const emailRaw = normalizeRequired(formData.get('email'), 254);
    const interests = normalizeOptional(formData.get('interests'), 2000);
    const sourceContext = normalizeOptional(formData.get('sourceContext'), 120);
    const sourcePageFromForm = resolveRedirectPath(normalizeOptional(formData.get('sourcePage'), 200), '/');

    sourcePage = sourcePageFromForm;

    logStep('parsed_form', {
      hasFirstName: Boolean(firstName),
      hasLastName: Boolean(lastName),
      hasEmail: Boolean(emailRaw),
      hasInterests: Boolean(interests),
      sourceContext,
      sourcePage,
    });

    if (!firstName) {
      logStep('missing_first_name');
      return redirectWithStatus('missing-first-name');
    }

    if (!emailRaw) {
      logStep('missing_email');
      return redirectWithStatus('missing-email');
    }

    const email = emailRaw.toLowerCase();

    if (!EMAIL_REGEX.test(email)) {
      logStep('invalid_email_format', { email });
      return redirectWithStatus('invalid-email');
    }

    logStep('env_check', {
      hasDbBinding: Boolean(env.DB_JEREMYSAYERS),
    });

    const newsletterDb = env.DB_JEREMYSAYERS;

    if (!newsletterDb) {
      logStep('missing_db_binding');
      return redirectWithStatus('db-error');
    }

    try {
      const tableInfo = await readNewsletterTablePresence(newsletterDb);
      logStep('db_table_check', {
        binding: 'DB_JEREMYSAYERS',
        hasNewsletterSubscribersTable: Boolean(tableInfo?.name),
        tableName: tableInfo?.name ?? null,
      });
    } catch (error) {
      console.error('[newsletter] table presence check failed', error);
      return redirectWithStatus('db-error');
    }

    let existingSubscriber: { id: number } | null = null;

    try {
      logStep('duplicate_check_start', {
        binding: 'DB_JEREMYSAYERS',
        table: 'newsletter_subscribers',
        email,
      });
      existingSubscriber = await newsletterDb
        .prepare('SELECT id FROM newsletter_subscribers WHERE email = ?1 LIMIT 1')
        .bind(email)
        .first<{ id: number }>();
      logStep('duplicate_check_complete', {
        email,
        foundExistingSubscriber: Boolean(existingSubscriber),
        existingSubscriberId: existingSubscriber?.id ?? null,
      });
    } catch (error) {
      console.error('[newsletter] duplicate check failed', error);
      return redirectWithStatus('db-error');
    }

    if (existingSubscriber) {
      return redirectWithStatus('duplicate');
    }

    try {
      logStep('insert_start', {
        binding: 'DB_JEREMYSAYERS',
        table: 'newsletter_subscribers',
        email,
        hasLastName: Boolean(lastName),
        hasInterests: Boolean(interests),
      });
      await newsletterDb
        .prepare(
          `INSERT INTO newsletter_subscribers (
            first_name,
            last_name,
            email,
            interests,
            created_at
          )
          VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)`
        )
        .bind(
          firstName,
          lastName,
          email,
          interests,
        )
        .run();
      logStep('insert_complete', { email });
    } catch (error) {
      console.error('[newsletter] insert failed', error);

      const maybeMessage = error instanceof Error ? error.message : '';
      if (maybeMessage.toLowerCase().includes('unique')) {
        return redirectWithStatus('duplicate');
      }

      return redirectWithStatus('db-error');
    }

    return redirectWithStatus('success');
  } catch (error) {
    console.error('[newsletter] unexpected handler failure', error);
    return redirectWithStatus('unknown-error');
  }
};

export const ALL: APIRoute = async ({ request, redirect }) => {
  const sourcePage = resolveRedirectPath(new URL(request.url).searchParams.get('sourcePage'), '/');
  const target = appendStatus(sourcePage, 'bad-method');
  console.error('[newsletter] bad method', { method: request.method, target });
  return redirect(target, 303);
};
