// api-ts/kugou-media.ts
// Stream the exact upstream media URL without forwarding Folia/KuGou account credentials.
export const config = { runtime: 'edge' };

const CDN_HOST = 'fs.youthandroid2.kugou.com';
const responseHeaders = { 'Cache-Control': 'private, no-store' };

export default async function handler(request         )                    {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { ...responseHeaders, Allow: 'GET, HEAD' } });
  }

  let source     ;
  try {
    source = new URL(new URL(request.url).searchParams.get('url') || '');
  } catch {
    return new Response('Invalid media URL', { status: 400, headers: responseHeaders });
  }
  // Fixed public CDN and signed media paths only: this endpoint is not a general URL proxy.
  if (!['http:', 'https:'].includes(source.protocol) || source.hostname !== CDN_HOST ||
      source.port || source.username || source.password || source.search || source.hash ||
      !/^\/\d{12}\/[a-f\d]{32}\/v3\/[^\s]+\.(mp3|flac|ogg|m4a|wav)$/i.test(source.pathname)) {
    return new Response('Unsupported media URL', { status: 400, headers: responseHeaders });
  }

  const range = request.headers.get('Range');
  if (range && (!/^bytes=(?:\d+-\d*|-\d+)$/.test(range) || range.length > 80)) {
    return new Response('Unsupported range', { status: 416, headers: responseHeaders });
  }

  try {
    // Preserve the provider's actual scheme; never disable TLS checks or follow redirects
    // to an unvalidated host. Streaming and byte ranges support Safari playback/seeking.
    const upstream = await fetch(source, {
      method: request.method,
      headers: range ? { Range: range } : {},
      redirect: 'manual',
      signal: request.signal,
    });
    if (![200, 206, 416].includes(upstream.status)) {
      await upstream.body?.cancel();
      return new Response('Media upstream unavailable', { status: 502, headers: responseHeaders });
    }
    const headers = new Headers(responseHeaders);
    for (const key of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']) {
      const value = upstream.headers.get(key);
      if (value) headers.set(key, value);
    }
    headers.set('X-Content-Type-Options', 'nosniff');
    if (upstream.status !== 416 && !/^(audio\/|application\/octet-stream)/i.test(headers.get('Content-Type') || '')) {
      await upstream.body?.cancel();
      return new Response('Invalid media response', { status: 502, headers: responseHeaders });
    }
    return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers });
  } catch {
    return new Response('Media connection failed', { status: 502, headers: responseHeaders });
  }
}
