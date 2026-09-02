require('dotenv').config({ path: require('path').join(__dirname, '..', 'pair.env') });

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestWaWebVersion,
  fetchLatestBaileysVersion,
  delay,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { encodeSession } = require('./session');

const BOT_NAME = process.env.BOT_NAME || 'TUNZY MD2';
const PORT = process.env.PORT || 8000;
const SESS_ROOT = path.join(__dirname, '..', 'pairing-sessions');

if (!fs.existsSync(SESS_ROOT)) fs.mkdirSync(SESS_ROOT, { recursive: true });

async function getWaVersion() {
  try {
    const { version } = await fetchLatestWaWebVersion({});
    return version;
  } catch (err) {
    const { version } = await fetchLatestBaileysVersion();
    return version;
  }
}

async function createPairingSession(number) {
  const sessionDir = path.join(SESS_ROOT, `${number}-${Date.now()}`);
  fs.mkdirSync(sessionDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const version = await getWaVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: [BOT_NAME, 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  let code = null;
  if (!state.creds.registered) {
    await delay(3000);
    code = await sock.requestPairingCode(number);
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection } = update;
    if (connection === 'open') {
      try {
        const sessionId = encodeSession(sessionDir);
        const jid = `${number}@s.whatsapp.net`;
        await sock.sendMessage(jid, {
          text:
            `Your ${BOT_NAME} SESSION_ID:\n\n${sessionId}\n\n` +
            `Keep this private. Paste it into your own deployment as SESSION_ID.`,
        });
      } catch (err) {
        console.log('Could not deliver SESSION_ID:', err.message);
      } finally {
        setTimeout(async () => {
          try { await sock.end(); } catch (e) {}
          fs.rmSync(sessionDir, { recursive: true, force: true });
        }, 3000);
      }
    }
  });

  return code;
}

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: `${BOT_NAME} pairing service` });
});

app.post('/pair', async (req, res) => {
  try {
    const { number } = req.body;
    if (!number) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const clean = number.replace(/[^0-9]/g, '');
    if (clean.length < 8) {
      return res.status(400).json({ error: 'Enter a valid number with country code' });
    }

    const rawCode = await createPairingSession(clean);
    if (!rawCode) {
      return res.status(400).json({ error: 'Could not generate a code. Try again.' });
    }

    const formatted = rawCode.match(/.{1,4}/g)?.join('-') || rawCode;
    return res.json({ code: formatted });
  } catch (err) {
    console.error('Pairing error:', err.message);
    return res.status(500).json({ error: 'Failed to generate pairing code' });
  }
});

app.listen(PORT, () => {
  console.log(`${BOT_NAME} pairing service running on port ${PORT}`);
});