// /home/r_/projects/jeremysayers/src/pages/api/newsletter.ts
import type { APIRoute } from 'astro';

export const prerender = false;

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });

export const POST: APIRoute = async ({ request, locals }) => {
  const contentType = request.headers.get('content-type') ?? '';
  const env = (locals as App.Locals).runtime?.env;
  const db = env?.DB_JEREMYSAYERS;

  let email = '';
  let firstName = '';
  let lastName = '';
  let interests = '';

  if (contentType.includes('application/json')) {
    const payload = await request.json();
    email = String(payload.email ?? '').trim();
    firstName = String(payload.firstName ?? '').trim();
    lastName = String(payload.lastName ?? '').trim();
    interests = String(payload.interests ?? '').trim();
  } else {
    const formData = await request.formData();
    email = String(formData.get('email') ?? '').trim();
    firstName = String(formData.get('firstName') ?? '').trim();
    lastName = String(formData.get('lastName') ?? '').trim();
    interests = String(formData.get('interests') ?? '').trim();
  }

  if (!email) {
    return json({ ok: false, message: 'Email is required.' }, 400);
  }

  if (!db) {
    return json(
      {
        ok: false,
        message: 'Newsletter storage is not configured yet.',
      },
      500
    );
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
        {
          ok: true,
          duplicate: true,
          message: 'That email is already subscribed for updates.',
        },
        200
      );
    }

    await db
      .prepare(
        `INSERT INTO newsletter_subscribers (first_name, last_name, email, interests)
         VALUES (?1, ?2, ?3, ?4)`
      )
      .bind(firstName || null, lastName || null, email, interests || null)
      .run();

    return json(
      {
        ok: true,
        message: 'Thanks. You are on the list for future updates from Jeremy.',
      },
      201
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.toLowerCase().includes('unique')) {
      return json(
        {
          ok: true,
          duplicate: true,
          message: 'That email is already subscribed for updates.',
        },
        200
      );
    }

    return json(
      {
        ok: false,
        message: 'Something went wrong while saving your signup. Please try again.',
      },
      500
    );
  }
};

export const ALL: APIRoute = async () =>
  json(
    {
      ok: false,
      message: 'Method not allowed.',
    },
    405
  );
