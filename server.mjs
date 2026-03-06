#!/usr/bin/env node
// Local server that serves static files AND proxies iNatur API calls
// Usage: node server.mjs
// Then open http://localhost:8765/

import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { extname, join, normalize, sep } from 'path';

const PORT = 8765;
const INATUR_BASE = 'https://www.inatur.no';
const PUBLIC_DIR = join(process.cwd(), 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

async function handleProxy(req, res) {
  // Proxy /api/inatur/* → https://www.inatur.no/*
  const targetPath = req.url.replace(/^\/api\/inatur/, '');
  const targetUrl = `${INATUR_BASE}${targetPath}`;

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'iNatur-Map-Local/1.0',
      },
    });

    const body = await response.text();
    res.writeHead(response.status, {
      'Content-Type': response.headers.get('content-type') || 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy error', message: err.message }));
  }
}

async function handleStatic(req, res) {
  const urlPath = (req.url || '/').split('?')[0];
  const routePath = (urlPath === '/' || urlPath === '/inatur-map.html') ? '/index.html' : urlPath;
  const normalizedPath = normalize(routePath.replace(/^\/+/, ''));
  const filePath = join(PUBLIC_DIR, normalizedPath);

  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${sep}`)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  try {
    await stat(filePath);
    const data = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

const server = createServer((req, res) => {
  const requestPath = req.url || '/';
  if (requestPath.startsWith('/api/inatur/')) {
    handleProxy(req, res);
  } else {
    handleStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`\n  iNatur Hyttekart server kjører!`);
  console.log(`  → http://localhost:${PORT}/\n`);
  console.log(`  Statiske filer serveres fra: ${PUBLIC_DIR}`);
  console.log(`  API-proxy: /api/inatur/* → ${INATUR_BASE}/*\n`);
});
