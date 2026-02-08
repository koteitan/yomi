// X API CORS Proxy - Cloudflare Worker
// Proxies requests to api.x.com with CORS headers for browser access.

const ALLOWED_ORIGINS = [
  'https://koteitan.github.io',
];

const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    return { ...CORS_HEADERS, 'Access-Control-Allow-Origin': origin };
  }
  return null;
}

export default {
  async fetch(request) {
    const corsHeaders = getCorsHeaders(request);
    if (!corsHeaders) {
      return new Response('Forbidden', { status: 403 });
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Proxy to api.x.com
    const url = new URL(request.url);
    const targetUrl = `https://api.x.com${url.pathname}${url.search}`;

    const proxyRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    try {
      const response = await fetch(proxyRequest);

      // Clone response and add CORS headers
      const newHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders)) {
        newHeaders.set(key, value);
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    } catch (e) {
      return new Response(`Proxy error: ${e.message}`, {
        status: 502,
        headers: corsHeaders,
      });
    }
  },
};
