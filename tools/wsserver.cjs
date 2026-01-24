#!/usr/bin/env node
// WebSocket Debug Server
// Receives console output from yomi app via WebSocket

const WebSocket = require('ws');

const args = process.argv.slice(2);
let port = 8080;

// Parse arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') {
    console.log(`Usage: node wsserver.cjs [options]

Options:
  -p, --port <port>  Port to listen on (default: 8080)
  -h, --help         Show this help message

Examples:
  node wsserver.cjs
  node wsserver.cjs -p 9000
  node wsserver.cjs -p 8080 > console-log.txt

Client usage:
  Open https://your-app/?ws=host:port in browser`);
    process.exit(0);
  } else if (arg === '-p' || arg === '--port') {
    port = parseInt(args[++i], 10);
    if (isNaN(port)) {
      console.error('Error: Invalid port number');
      process.exit(1);
    }
  } else if (!isNaN(parseInt(arg, 10))) {
    // Support legacy positional argument
    port = parseInt(arg, 10);
  }
}

const wss = new WebSocket.Server({ port });
console.error(`[wsserver] listening on ws://0.0.0.0:${port}`);

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
