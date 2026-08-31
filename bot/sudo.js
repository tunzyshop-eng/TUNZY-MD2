const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SUDO_FILE = path.join(DATA_DIR, 'sudo.json');

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SUDO_FILE)) fs.writeFileSync(SUDO_FILE, JSON.stringify([]));
}

function loadSudo() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(SUDO_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveSudo(list) {
  ensureFile();
  fs.writeFileSync(SUDO_FILE, JSON.stringify(list, null, 2));
}

function addSudo(number) {
  const list = loadSudo();
  if (!list.includes(number)) {
    list.push(number);
    saveSudo(list);
  }
  return list;
}

function removeSudo(number) {
  let list = loadSudo();
  list = list.filter((n) => n !== number);
  saveSudo(list);
  return list;
}

module.exports = { loadSudo, addSudo, removeSudo };