#!/usr/bin/env node
// WebSocket Debug Server
// Receives console output from yomi app via WebSocket

const WebSocket = require('ws');
const https = require('https');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
let port = 8080;
let useSSL = false;

// Parse arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') {
    console.log(`Usage: node wsserver.cjs [options]

Options:
  -p, --port <port>  Port to listen on (default: 8080)
  -s, --ssl          Enable SSL (wss://) with self-signed certificate
  -h, --help         Show this help message

Examples:
  node wsserver.cjs
  node wsserver.cjs -p 9000
  node wsserver.cjs -s -p 9000        # SSL mode for HTTPS pages
  node wsserver.cjs -p 8080 > console-log.txt

Client usage:
  HTTP:  http://localhost:5173/?ws=localhost:8080
  HTTPS: https://localhost:5173/?ws=localhost:9000  (use -s flag)`);
    process.exit(0);
  } else if (arg === '-p' || arg === '--port') {
    port = parseInt(args[++i], 10);
    if (isNaN(port)) {
      console.error('Error: Invalid port number');
      process.exit(1);
    }
  } else if (arg === '-s' || arg === '--ssl') {
    useSSL = true;
  } else if (!isNaN(parseInt(arg, 10))) {
    // Support legacy positional argument
    port = parseInt(arg, 10);
  }
}

let wss;

if (useSSL) {
  // Generate self-signed certificate on the fly
  const { execSync } = require('child_process');
  const certDir = path.join(__dirname, '.certs');
  const keyPath = path.join(certDir, 'key.pem');
  const certPath = path.join(certDir, 'cert.pem');

  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
  }

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.error('[wsserver] generating self-signed certificate...');
    try {
      execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=localhost"`, { stdio: 'pipe' });
    } catch (e) {
      console.error('[wsserver] failed to generate certificate. Make sure openssl is installed.');
      console.error('[wsserver] On Windows, you can install it via: winget install OpenSSL');
      process.exit(1);
    }
  }

  const server = https.createServer({
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  });

  wss = new WebSocket.Server({ server });
  server.listen(port);
  console.error(`[wsserver] listening on wss://0.0.0.0:${port} (SSL mode)`);
} else {
  wss = new WebSocket.Server({ port });
  console.error(`[wsserver] listening on ws://0.0.0.0:${port}`);
}

wss.on('connection', (ws, req) => {
  const clientAddr = req.socket.remoteAddress;
  console.error(`[wsserver] client connected: ${clientAddr}`);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const time = msg.timestamp ? msg.timestamp.split('T')[1].split('.')[0] : '';
      const level = msg.level ? `[${msg.level}]` : '';
      console.log(`${time} ${level} ${msg.message}`);
    } catch {
      console.log(data.toString());
    }
  });

  ws.on('close', () => {
    console.error(`[wsserver] client disconnected: ${clientAddr}`);
  });

  ws.on('error', (err) => {
    console.error(`[wsserver] error:`, err.message);
  });
});

wss.on('error', (err) => {
  console.error(`[wsserver] server error:`, err.message);
});

process.on('SIGINT', () => {
  console.error('\n[wsserver] shutting down...');
  wss.close();
  process.exit(0);
});
