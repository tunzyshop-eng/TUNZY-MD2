require('./config');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestWaWebVersion,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const { decodeSession } = require('./bot/session');
const { loadSudo, addSudo, removeSudo } = require('./bot/sudo');

const BOT_NAME = process.env.BOT_NAME || 'TUNZY MD2';
const PREFIX = process.env.PREFIX || '.';
const OWNER_NUMBER = (process.env.OWNER_NUMBER || '').replace(/[^0-9]/g, '');
const ENV_SUDO_NUMBERS = (process.env.SUDO_NUMBERS || '')
  .split(',')
  .map((n) => n.replace(/[^0-9]/g, ''))
  .filter(Boolean);

const SESSION_PATH = path.join(__dirname, 'session');

async function getWaVersion() {
  try {
    const { version } = await fetchLatestWaWebVersion({});
    return version;
  } catch (err) {
    const { version } = await fetchLatestBaileysVersion();
    return version;
  }
}

function getAuthorizedList() {
  const dynamicSudo = loadSudo();
  return [...new Set([OWNER_NUMBER, ...ENV_SUDO_NUMBERS, ...dynamicSudo])].filter(Boolean);
}

function isAuthorized(jid) {
  if (!jid) return false;
  const num = jid.split('@')[0].split(':')[0];
  return getAuthorizedList().includes(num);
}

function isOwner(jid) {
  if (!jid) return false;
  const num = jid.split('@')[0].split(':')[0];
  return num === OWNER_NUMBER;
}

function restoreSessionIfNeeded() {
  const alreadyHasCreds = fs.existsSync(path.join(SESSION_PATH, 'creds.json'));
  if (alreadyHasCreds) return;

  const sessionId = process.env.SESSION_ID;
  if (!sessionId) {
    console.log('No SESSION_ID set and no local session found. Get one from the TUNZY MD2 website.');
    return;
  }

  try {
    decodeSession(sessionId, SESSION_PATH);
    console.log('Session restored from SESSION_ID.');
  } catch (err) {
    console.log('Failed to restore SESSION_ID:', err.message);
  }
}

async function startBot() {
  restoreSessionIfNeeded();

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
  const version = await getWaVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: [BOT_NAME, 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log(`${BOT_NAME} connected successfully.`);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.participant || msg.key.remoteJid;
    if (!isAuthorized(sender)) return;

    const body =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      '';

    if (!body.startsWith(PREFIX)) return;

    const args = body.slice(PREFIX.length).trim().split(/\s+/);
    const command = args.shift().toLowerCase();
    const jid = msg.key.remoteJid;

    if (command === 'ping') {
      await sock.sendMessage(jid, { text: 'pong' }, { quoted: msg });
      return;
    }

    if (command === 'sudo') {
      const sub = (args.shift() || '').toLowerCase();

      if (sub === 'list') {
        const all = getAuthorizedList();
        const text = all.length
          ? all.map((n, i) => `${i + 1}. ${n}`).join('\n')
          : 'No authorized numbers yet.';
        await sock.sendMessage(jid, { text: `Authorized numbers:\n${text}` }, { quoted: msg });
        return;
      }

      const target = (args[0] || '').replace(/[^0-9]/g, '');

      if (sub === 'add') {
        if (!target) {
          await sock.sendMessage(jid, { text: 'Usage: .sudo add 234XXXXXXXXXX' }, { quoted: msg });
          return;
        }
        addSudo(target);
        await sock.sendMessage(jid, { text: `${target} added as sudo.` }, { quoted: msg });
        return;
      }

      if (sub === 'del') {
        if (!isOwner(sender)) {
          await sock.sendMessage(jid, { text: 'Only the owner can remove sudo.' }, { quoted: msg });
          return;
        }
        if (!target) {
          await sock.sendMessage(jid, { text: 'Usage: .sudo del 234XXXXXXXXXX' }, { quoted: msg });
          return;
        }
        removeSudo(target);
        await sock.sendMessage(jid, { text: `${target} removed from sudo.` }, { quoted: msg });
        return;
      }

      await sock.sendMessage(jid, { text: 'Usage: .sudo add|del|list <number>' }, { quoted: msg });
    }
  });
}

startBot().catch((err) => {
  console.error('Fatal error starting bot:', err);
  process.exit(1);
});