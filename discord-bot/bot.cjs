#!/usr/bin/env node
/**
 * yomi Discord Bot
 *
 * Bridges Discord channel messages to yomi via WebSocket.
 *
 * Usage:
 *   node bot.cjs --token YOUR_BOT_TOKEN --channel CHANNEL_ID [--port 8765]
 */

const { Client, GatewayIntentBits } = require('discord.js');
const { WebSocketServer } = require('ws');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    token: null,
    channel: null,
    port: 8765,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--token':
        config.token = args[++i];
        break;
      case '--channel':
        config.channel = args[++i];
        break;
      case '--port':
        config.port = parseInt(args[++i], 10);
        break;
      case '--help':
      case '-h':
        console.log(`
yomi Discord Bot

Usage:
  node bot.cjs --token YOUR_BOT_TOKEN --channel CHANNEL_ID [--port 8765]

Options:
  --token    Discord bot token (required)
  --channel  Discord channel ID to monitor (required)
  --port     WebSocket server port (default: 8765)
  --help     Show this help message
`);
        process.exit(0);
    }
  }

  if (!config.token) {
    console.error('Error: --token is required');
    process.exit(1);
  }
  if (!config.channel) {
    console.error('Error: --channel is required');
    process.exit(1);
  }

  return config;
}

const config = parseArgs();

// WebSocket server
const wss = new WebSocketServer({ port: config.port });
const clients = new Set();

wss.on('connection', (ws) => {
  console.log('[ws] Client connected');
  clients.add(ws);

  ws.on('close', () => {
    console.log('[ws] Client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('[ws] Client error:', err.message);
    clients.delete(ws);
  });
});

console.log(`[ws] WebSocket server listening on port ${config.port}`);

// Broadcast message to all connected clients
function broadcast(message) {
  const data = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(data);
    }
  }
}

// Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  console.log(`[discord] Logged in as ${client.user.tag}`);
  console.log(`[discord] Monitoring channel: ${config.channel}`);
});

client.on('messageCreate', (message) => {
  // Ignore messages from other channels
  if (message.channel.id !== config.channel) return;

  // Ignore bot messages
  if (message.author.bot) return;

  // Ignore empty messages (e.g., attachment-only)
  if (!message.content || message.content.trim() === '') return;

  const payload = {
    type: 'message',
    id: message.id,
    channelId: message.channel.id,
    author: {
      id: message.author.id,
      username: message.author.username,
      displayName: message.member?.displayName || message.author.displayName || message.author.username,
      avatarUrl: message.author.displayAvatarURL({ size: 128 }) || null,
    },
    content: message.content,
    timestamp: message.createdAt.toISOString(),
  };

  console.log(`[discord] ${payload.author.displayName}: ${payload.content.slice(0, 50)}${payload.content.length > 50 ? '...' : ''}`);
  broadcast(payload);
});

client.on('error', (err) => {
  console.error('[discord] Client error:', err.message);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[bot] Shutting down...');
  client.destroy();
  wss.close();
  process.exit(0);
});

// Start the bot
client.login(config.token).catch((err) => {
  console.error('[discord] Login failed:', err.message);
  process.exit(1);
});
