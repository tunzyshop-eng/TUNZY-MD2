const fs = require('fs');
const path = require('path');

const PREFIX = 'TUNZY_MD2_';

function encodeSession(sessionDir) {
  const files = fs.readdirSync(sessionDir);
  const data = {};
  for (const file of files) {
    const filePath = path.join(sessionDir, file);
    if (fs.statSync(filePath).isFile()) {
      data[file] = fs.readFileSync(filePath, 'utf8');
    }
  }
  const json = JSON.stringify(data);
  return PREFIX + Buffer.from(json).toString('base64url');
}

function decodeSession(sessionId, sessionDir) {
  if (!sessionId.startsWith(PREFIX)) {
    throw new Error('Invalid SESSION_ID format');
  }
  const b64 = sessionId.slice(PREFIX.length);
  const json = Buffer.from(b64, 'base64url').toString('utf8');
  const data = JSON.parse(json);

  fs.mkdirSync(sessionDir, { recursive: true });
  for (const [name, content] of Object.entries(data)) {
    fs.writeFileSync(path.join(sessionDir, name), content, 'utf8');
  }
}

module.exports = { encodeSession, decodeSession };