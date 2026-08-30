require('../config');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const BOT_NAME = process.env.BOT_NAME || 'TUNZY MD2';
const PREFIX = process.env.PREFIX || '.';
const PORT = process.env.PORT || 8000;
const OWNER_NUMBER = (process.env.OWNER_NUMBER || '').replace(/[^0-9]/g, '');
const SUDO_NUMBERS = (process.env.SUDO_NUMBERS || '')
  .split(',')
  .map((n) => n.replace(/[^0-9]/g, ''))
  .filter(Boolean);

const AUTHORIZED = [OWNER_NUMBER, ...SUDO_NUMBERS].filter(Boolean);
const SESSION_PATH = path.join(__dirname, '..', 'session');

const SESSION_ID = `TUNZY_MD2_${crypto.randomBytes(8).toString('hex').toUpperCase()}`;

let sock;
let hasSentSessionId = false;

function isAuthorized(jid) {
  if (!jid) return false;
  const num = jid.split('@')[0].split(':')[0];
  return AUTHORIZED.includes(num);
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: [BOT_NAME, 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log(`${BOT_NAME} connected successfully.`);

      if (OWNER_NUMBER && !hasSentSessionId) {
        hasSentSessionId = true;
        const ownerJid = `${OWNER_NUMBER}@s.whatsapp.net`;
        try {
          await sock.sendMessage(ownerJid, {
            text:
              `${BOT_NAME} connected successfully.\n\n` +
              `SESSION_ID:\n${SESSION_ID}\n\n` +
              `Keep this ID safe. Do not share it with anyone.`,
          });
        } catch (err) {
          console.log('Could not message owner:', err.message);
        }
      }
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

// --- Express API for pairing ---
const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok', bot: BOT_NAME });
});

app.post('/pair', async (req, res) => {
  try {
    const { number } = req.body;

    if (!number) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    if (!sock) {
      return res.status(503).json({ error: 'Bot is starting up. Try again shortly.' });
    }

    if (sock.authState?.creds?.registered) {
      return res.status(400).json({
        error: 'This bot instance is already paired. Delete the session folder to re-pair.',
      });
    }

    const cleanNumber = number.replace(/[^0-9]/g, '');
    if (cleanNumber.length < 8) {
      return res.status(400).json({ error: 'Enter a valid number with country code' });
    }

    const rawCode = await sock.requestPairingCode(cleanNumber);
    const formattedCode = rawCode.match(/.{1,4}/g)?.join('-') || rawCode;

    return res.json({ code: formattedCode });
  } catch (err) {
    console.error('Pairing error:', err.message);
    return res.status(500).json({ error: 'Failed to generate pairing code' });
  }
});

app.listen(PORT, () => {
  console.log(`Pairing API running on port ${PORT}`);
});

startBot().catch((err) => {
  console.error('Fatal error starting bot:', err);
  process.exit(1);
});