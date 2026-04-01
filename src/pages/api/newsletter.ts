// /home/r_/projects/jeremysayers/src/pages/api/newsletter.ts
import type { APIRoute } from 'astro';

export const prerender = false;

type NewsletterState =
  | 'success'
  | 'missing-email'
  | 'invalid-email'
  | 'missing-first-name'
  | 'duplicate'
  | 'bad-method'
  | 'bad-request'
  | 'db-error'
  | 'unknown-error';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (
  state: NewsletterState,
  message: string,
  status: number,
  extra: Record<string, unknown> = {}
) =>
  new Response(
    JSON.stringify({
      ok: state === 'success' || state === 'duplicate',
      state,
      message,
      ...extra,
    }),
    {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
    }
  );

export const POST: APIRoute = async ({ request, locals }) => {
  const contentType = request.headers.get('content-type') ?? '';
  const env = (locals as App.Locals).runtime?.env;
  const db = env?.DB_JEREMYSAYERS;

  let email = '';
  let firstName = '';
  let lastName = '';
  let interests = '';

  try {
    if (contentType.includes('application/json')) {
      const payload = await request.json();
      email = String(payload.email ?? '').trim();
      firstName = String(payload.firstName ?? '').trim();
      lastName = String(payload.lastName ?? '').trim();
      interests = String(payload.interests ?? '').trim();
    } else if (
      contentType.includes('multipart/form-data') ||
      contentType.includes('application/x-www-form-urlencoded') ||
      contentType === ''
    ) {
      const formData = await request.formData();
      email = String(formData.get('email') ?? '').trim();
      firstName = String(formData.get('firstName') ?? '').trim();
      lastName = String(formData.get('lastName') ?? '').trim();
      interests = String(formData.get('interests') ?? '').trim();
    } else {
      console.error('Newsletter bad request: unsupported content type', {
        contentType,
      });
      return json('bad-request', 'The signup request format was not recognized.', 400);
    }
  } catch (error) {
    console.error('Newsletter bad request: failed to parse request body', error);
    return json('bad-request', 'The signup request could not be processed.', 400);
  }

  if (!firstName) {
    return json('missing-first-name', 'First name is required.', 400);
  }

  if (!email) {
    return json('missing-email', 'Email is required.', 400);
  }

  if (!EMAIL_PATTERN.test(email)) {
    return json('invalid-email', 'Enter a valid email address.', 400);
  }

  if (!db) {
    console.error('Newsletter database binding is missing: DB_JEREMYSAYERS');
    return json('db-error', 'Newsletter storage is not configured yet.', 500);
  }

  try {
    const existingSubscriber = await db
      .prepare(
        `SELECT id
         FROM newsletter_subscribers
         WHERE email = ?1
         LIMIT 1`
      )
      .bind(email)
      .first<{ id: number | string | null }>();

    if (existingSubscriber?.id) {
      return json(
        'duplicate',
        'That email is already subscribed for updates.',
        200,
        { duplicate: true }
      );
    }

    await db
      .prepare(
        `INSERT INTO newsletter_subscribers (first_name, last_name, email, interests)
         VALUES (?1, ?2, ?3, ?4)`
      )
      .bind(firstName, lastName || null, email, interests || null)
      .run();

    return json(
      'success',
      'Thanks. You are on the list for future updates from Jeremy.',
      201
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Newsletter database error', error);

    if (message.toLowerCase().includes('unique')) {
      return json(
        'duplicate',
        'That email is already subscribed for updates.',
        200,
        { duplicate: true }
      );
    }

    if (
      message.toLowerCase().includes('d1') ||
      message.toLowerCase().includes('sqlite') ||
      message.toLowerCase().includes('database')
    ) {
      return json(
        'db-error',
        'Something went wrong while saving your signup.',
        500
      );
    }

    return json(
      'unknown-error',
      'Something unexpected went wrong while processing your signup.',
      500
    );
  }
};

export const ALL: APIRoute = async ({ request }) => {
  console.error('Newsletter bad method', { method: request.method });
  return json('bad-method', 'Method not allowed.', 405);
};
