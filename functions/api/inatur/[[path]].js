export async function onRequest(context) {
  const url = new URL(context.request.url);
  const targetPath = url.pathname.replace(/^\/api\/inatur/, '');
  const targetUrl = `https://www.inatur.no${targetPath}${url.search}`;

  const response = await fetch(targetUrl, {
    method: context.request.method,
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'iNatur-Map/1.0',
    },
  });

  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') || 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
