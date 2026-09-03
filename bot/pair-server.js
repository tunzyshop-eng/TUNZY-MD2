require('dotenv').config({ path: require('path').join(__dirname, '..', 'pair.env') });

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  delay,
} = require('baileys');
const pino = require('pino');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { PhoneNumber } = require('awesome-phonenumber');
const { encodeSession } = require('./session');

const BOT_NAME = process.env.BOT_NAME || 'TUNZY MD2';
const PORT = process.env.PORT || 8000;
const SESS_ROOT = path.join(__dirname, '..', 'pairing-sessions');

if (!fs.existsSync(SESS_ROOT)) fs.mkdirSync(SESS_ROOT, { recursive: true });

const qrSessions = new Map();

function cleanupQrSession(token) {
  const entry = qrSessions.get(token);
  if (!entry) return;
  try { entry.sock.end(); } catch (e) {}
  fs.rmSync(entry.dir, { recursive: true, force: true });
  qrSessions.delete(token);
}

setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of qrSessions.entries()) {
    if (now - entry.createdAt > 3 * 60 * 1000) {
      cleanupQrSession(token);
    }
  }
}, 60 * 1000);

function isValidNumber(number) {
  try {
    const pn = new PhoneNumber('+' + number);
    return pn.isValid();
  } catch (e) {
    return false;
  }
}

async function createPairingSession(number) {
  const sessionDir = path.join(SESS_ROOT, `${number}-${Date.now()}`);
  fs.mkdirSync(sessionDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  let code = null;
  if (!state.creds.registered) {
    await delay(1500);
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

async function startQrSession() {
  const token = crypto.randomBytes(12).toString('hex');
  const sessionDir = path.join(SESS_ROOT, `qr-${token}`);
  fs.mkdirSync(sessionDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  const entry = {
    sock,
    dir: sessionDir,
    status: 'pending',
    qrDataUrl: null,
    createdAt: Date.now(),
  };
  qrSessions.set(token, entry);

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr } = update;

    if (qr) {
      try {
        entry.qrDataUrl = await QRCode.toDataURL(qr);
      } catch (err) {
        console.log('QR encode failed:', err.message);
      }
    }

    if (connection === 'open') {
      entry.status = 'connected';
      const jidNumber = sock.user?.id?.split(':')[0]?.split('@')[0];
      try {
        const sessionId = encodeSession(sessionDir);
        if (jidNumber) {
          const jid = `${jidNumber}@s.whatsapp.net`;
          await sock.sendMessage(jid, {
            text:
              `Your ${BOT_NAME} SESSION_ID:\n\n${sessionId}\n\n` +
              `Keep this private. Paste it into your own deployment as SESSION_ID.`,
          });
        }
      } catch (err) {
        console.log('Could not deliver SESSION_ID:', err.message);
      } finally {
        setTimeout(() => cleanupQrSession(token), 5000);
      }
    }

    if (connection === 'close' && entry.status !== 'connected') {
      entry.status = 'expired';
      setTimeout(() => cleanupQrSession(token), 2000);
    }
  });

  for (let i = 0; i < 20 && !entry.qrDataUrl; i++) {
    await delay(300);
  }

  return token;
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

    if (!isValidNumber(clean)) {
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

app.post('/qr/start', async (req, res) => {
  try {
    const token = await startQrSession();
    const entry = qrSessions.get(token);
    if (!entry || !entry.qrDataUrl) {
      return res.status(500).json({ error: 'Could not generate QR code. Try again.' });
    }
    return res.json({ token, qr: entry.qrDataUrl });
  } catch (err) {
    console.error('QR start error:', err.message);
    return res.status(500).json({ error: 'Failed to start QR session' });
  }
});

app.get('/qr/status', (req, res) => {
  const { token } = req.query;
  const entry = qrSessions.get(token);
  if (!entry) {
    return res.json({ status: 'expired' });
  }
  return res.json({ status: entry.status, qr: entry.qrDataUrl });
});

app.listen(PORT, () => {
  console.log(`${BOT_NAME} pairing service running on port ${PORT}`);
});