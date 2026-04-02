// /home/r_/projects/jeremysayers/src/pages/api/newsletter.ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  isValidNewsletterEmail,
  normalizeNewsletterEmail,
  normalizeNewsletterOptional,
  normalizeNewsletterRequired,
  resolveNewsletterRedirectPath,
  submitNewsletterSignup
} from '../../lib/newsletter/service';

export const prerender = false;

const DEBUG = import.meta.env.DEV;

type SignupStatus =
  | 'success'
  | 'duplicate'
  | 'suppressed'
  | 'missing-email'
  | 'invalid-email'
  | 'missing-first-name'
  | 'missing-turnstile-site-key'
  | 'missing-turnstile-secret'
  | 'turnstile-missing-token'
  | 'turnstile-failed'
  | 'bad-method'
  | 'bad-request'
  | 'db-error'
  | 'unknown-error';

const appendStatus = (path: string, status: SignupStatus, sourceContext?: string | null) => {
  const url = new URL(path, 'http://localhost');
  url.searchParams.set('newsletter', status);
  if (sourceContext) {
    url.searchParams.set('newsletterSource', sourceContext);
  }
  return `${url.pathname}${url.search}`;
};

const logStep = (step: string, data?: Record<string, unknown>) => {
  if (!DEBUG) return;
  console.log(`[newsletter] ${step}`, data ?? {});
};

export const POST: APIRoute = async ({ request, redirect }) => {
  let sourcePage = '/';
  let sourceContext: string | null = null;

  const redirectWithStatus = (status: SignupStatus) => {
    const target = appendStatus(sourcePage, status, sourceContext);
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

    const firstName = normalizeNewsletterRequired(formData.get('firstName'), 120);
    const lastName = normalizeNewsletterOptional(formData.get('lastName'), 120);
    const emailRaw = normalizeNewsletterRequired(formData.get('email'), 254);
    const interests = normalizeNewsletterOptional(formData.get('interests'), 2000);
    sourceContext = normalizeNewsletterOptional(formData.get('sourceContext'), 120);
    const sourcePageFromForm = resolveNewsletterRedirectPath(
      normalizeNewsletterOptional(formData.get('sourcePage'), 200),
      '/'
    );
    const turnstileToken = normalizeNewsletterOptional(formData.get('cf-turnstile-response'), 4096);

    sourcePage = sourcePageFromForm;

    logStep('parsed_form', {
      hasFirstName: Boolean(firstName),
      hasLastName: Boolean(lastName),
      hasEmail: Boolean(emailRaw),
      hasInterests: Boolean(interests),
      sourceContext,
      sourcePage,
      hasTurnstileToken: Boolean(turnstileToken),
    });

    if (!firstName) {
      logStep('missing_first_name');
      return redirectWithStatus('missing-first-name');
    }

    if (!emailRaw) {
      logStep('missing_email');
      return redirectWithStatus('missing-email');
    }

    const email = normalizeNewsletterEmail(emailRaw);

    if (!isValidNewsletterEmail(email)) {
      logStep('invalid_email_format', { email });
      return redirectWithStatus('invalid-email');
    }

    const turnstileSiteKey = env.PUBLIC_TURNSTILE_SITE_KEY;
    const turnstileSecret = env.TURNSTILE_SECRET_KEY;

    logStep('env_check', {
      hasTurnstileSiteKey: Boolean(turnstileSiteKey),
      hasTurnstileSecret: Boolean(turnstileSecret),
      hasDbBinding: Boolean(env.DB_JEREMYSAYERS),
    });

    if (!turnstileSiteKey) {
      logStep('missing_turnstile_site_key');
      return redirectWithStatus('missing-turnstile-site-key');
    }

    if (!turnstileSecret) {
      logStep('missing_turnstile_secret');
      return redirectWithStatus('missing-turnstile-secret');
    }

    if (!turnstileToken) {
      logStep('missing_turnstile_token');
      return redirectWithStatus('turnstile-missing-token');
    }

    try {
      const verificationBody = new URLSearchParams({
        secret: turnstileSecret,
        response: turnstileToken,
      });

      const remoteIp = request.headers.get('CF-Connecting-IP');
      if (remoteIp) {
        verificationBody.set('remoteip', remoteIp);
      }

      const verificationResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: verificationBody.toString(),
      });

      const verificationResult = await verificationResponse.json() as {
        success?: boolean;
        'error-codes'?: string[];
      };

      logStep('turnstile_verification_complete', {
        httpOk: verificationResponse.ok,
        success: Boolean(verificationResult.success),
        errorCodes: verificationResult['error-codes'] ?? [],
      });

      if (!verificationResponse.ok || !verificationResult.success) {
        return redirectWithStatus('turnstile-failed');
      }
    } catch (error) {
      console.error('[newsletter] turnstile verification failed', error);
      return redirectWithStatus('turnstile-failed');
    }

    if (!env.DB_JEREMYSAYERS) {
      logStep('missing_db_binding');
      return redirectWithStatus('db-error');
    }

    try {
      const outcome = await submitNewsletterSignup({
        env,
        firstName,
        lastName,
        email,
        interests,
        sourcePage,
        sourceContext,
        siteUrl: new URL(request.url).origin,
        remoteIp: request.headers.get('CF-Connecting-IP'),
        userAgent: request.headers.get('User-Agent')
      });
      logStep('signup_outcome', { email, outcome });
      if (outcome === 'already_active') {
        return redirectWithStatus('duplicate');
      }
      if (outcome === 'suppressed') {
        return redirectWithStatus('suppressed');
      }
      return redirectWithStatus('success');
    } catch (error) {
      console.error('[newsletter] signup persistence failed', error);
      return redirectWithStatus('db-error');
    }
  } catch (error) {
    console.error('[newsletter] unexpected handler failure', error);
    return redirectWithStatus('unknown-error');
  }
};

export const ALL: APIRoute = async ({ request, redirect }) => {
  const sourcePage = resolveNewsletterRedirectPath(new URL(request.url).searchParams.get('sourcePage'), '/');
  const target = appendStatus(sourcePage, 'bad-method');
  console.error('[newsletter] bad method', { method: request.method, target });
  return redirect(target, 303);
};
