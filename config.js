const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envPath = path.join(__dirname, '.env');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  console.log('⚠️  No .env file found. Copy config.env.example to .env and fill it in.');
}

module.exports = process.env;