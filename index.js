const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function installDeps() {
  console.log('Installing dependencies...');
  execSync('npm install', { stdio: 'inherit', cwd: __dirname });
}

function start() {
  const child = spawn(process.argv[0], [path.join('bot', 'bot.js')], {
    cwd: __dirname,
    stdio: 'inherit',
  });

  child.on('exit', (code) => {
    if (code === 0) {
      console.log('Bot stopped gracefully.');
    } else {
      console.log(`Bot exited with code ${code}, restarting in 3s...`);
      setTimeout(start, 3000);
    }
  });
}

console.log('Starting TUNZY MD2...');

if (!fs.existsSync(path.join(__dirname, 'node_modules'))) {
  installDeps();
} else {
  console.log('Dependencies already installed, skipping install.');
}

start();