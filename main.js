require('./config');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const path = require('path');

const BOT_NAME = process.env.BOT_NAME || 'TUNZY MD2';
const PREFIX = process.env.PREFIX || '.';
const OWNER_NUMBER = (process.env.OWNER_NUMBER || '').replace(/[^0-9]/g, '');
const SUDO_NUMBERS = (process.env.SUDO_NUMBERS || '')
  .split(',')
  .map((n) => n.replace(/[^0-9]/g, ''))
  .filter(Boolean);

const AUTHORIZED = [OWNER_NUMBER, ...SUDO_NUMBERS].filter(Boolean);

function isAuthorized(jid) {
  if (!jid) return false;
  const num = jid.split('@')[0].split(':')[0];
  return AUTHORIZED.includes(num);
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(
    path.join(__dirname, 'session')
  );
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
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
      if (OWNER_NUMBER) console.log(`Owner: ${OWNER_NUMBER}`);
      if (SUDO_NUMBERS.length) console.log(`Sudo: ${SUDO_NUMBERS.join(', ')}`);
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
    }
  });
}

startBot().catch((err) => {
  console.error('Fatal error starting bot:', err);
  process.exit(1);
});