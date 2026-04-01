// /home/r_/projects/jeremysayers/src/pages/sitemap.xml.ts
import type { APIRoute } from 'astro';
import { navLinks, site } from '../data/site';

export const GET: APIRoute = async () => {
  const urls = [
    ...navLinks.map((link) => link.href),
    '/media/',
    '/speaking/',
    '/get-involved/',
    '/issues/'
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((path) => `  <url><loc>${new URL(path, site.url).toString()}</loc></url>`)
  .join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8'
    }
  });
};
