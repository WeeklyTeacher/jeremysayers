// /home/r_/projects/jeremysayers/src/pages/api/newsletter/resend.ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  isValidNewsletterEmail,
  normalizeNewsletterEmail,
  normalizeNewsletterRequired,
  resendNewsletterConfirmation
} from '../../../lib/newsletter/service';

export const prerender = false;

const appendStatus = (path: string, status: string, email?: string | null) => {
  const url = new URL(path, 'http://localhost');
  url.searchParams.set('status', status);
  if (email) {
    url.searchParams.set('email', email);
  }
  return `${url.pathname}${url.search}`;
};

export const POST: APIRoute = async ({ request, redirect }) => {
  const formData = await request.formData();
  const emailRaw = normalizeNewsletterRequired(formData.get('email'), 254);
  const redirectPath = '/newsletter/resend/';

  if (!emailRaw || !isValidNewsletterEmail(emailRaw)) {
    return redirect(appendStatus(redirectPath, 'invalid-email'), 303);
  }

  try {
    await resendNewsletterConfirmation({
      env,
      email: normalizeNewsletterEmail(emailRaw),
      siteUrl: new URL(request.url).origin
    });
  } catch (error) {
    console.error('[newsletter] resend confirmation failed', error);
  }

  return redirect(appendStatus(redirectPath, 'sent', normalizeNewsletterEmail(emailRaw)), 303);
};
