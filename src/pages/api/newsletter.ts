// /home/r_/projects/jeremysayers/src/pages/api/newsletter.ts
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
  const contentType = request.headers.get('content-type') ?? '';

  let email = '';
  let firstName = '';
  let lastName = '';
  let interests = '';
  let sourceContext = 'site';

  if (contentType.includes('application/json')) {
    const payload = await request.json();
    email = String(payload.email ?? '').trim();
    firstName = String(payload.firstName ?? '').trim();
    lastName = String(payload.lastName ?? '').trim();
    interests = String(payload.interests ?? '').trim();
    sourceContext = String(payload.sourceContext ?? 'site').trim();
  } else {
    const formData = await request.formData();
    email = String(formData.get('email') ?? '').trim();
    firstName = String(formData.get('firstName') ?? '').trim();
    lastName = String(formData.get('lastName') ?? '').trim();
    interests = String(formData.get('interests') ?? '').trim();
    sourceContext = String(formData.get('sourceContext') ?? 'site').trim();
  }

  if (!email) {
    return new Response(JSON.stringify({ ok: false, message: 'Email is required.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      message: 'Thanks. You are on the list for future updates from Jeremy.',
      submission: { email, firstName, lastName, interests, sourceContext }
    }),
    {
      status: 202,
      headers: { 'content-type': 'application/json' }
    }
  );
};
