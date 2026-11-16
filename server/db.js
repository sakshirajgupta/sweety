// Always load the .env beside this file, regardless of the terminal directory.
require('dotenv').config({ path: require('node:path').join(__dirname, '.env'), quiet: true });
const { Pool } = require('pg');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing from server/.env.');
const dateTypes = require('./date-types');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, types: dateTypes });
pool.on('error', error => console.error('Idle database connection error:', error.code || error.name));
module.exports = pool;
