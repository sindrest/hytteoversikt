#!/usr/bin/env node
// Local server that serves static files AND proxies iNatur API calls
// Usage: node server.mjs
// Then open http://localhost:8765/inatur-map.html

import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { join, extname } from 'path';

const PORT = 8765;
const INATUR_BASE = 'https://www.inatur.no';

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
  const urlPath = req.url.split('?')[0];
  const filePath = join(process.cwd(), urlPath === '/' ? '/inatur-map.html' : urlPath);

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
  if (req.url.startsWith('/api/inatur/')) {
    handleProxy(req, res);
  } else {
    handleStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`\n  iNatur Hyttekart server kjører!`);
  console.log(`  → http://localhost:${PORT}/inatur-map.html\n`);
  console.log(`  Statiske filer serveres fra: ${process.cwd()}`);
  console.log(`  API-proxy: /api/inatur/* → ${INATUR_BASE}/*\n`);
});
