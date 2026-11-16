const { Pool, types } = require('pg');
require('dotenv').config();

// DATE (oid 1082) se devuelve como 'YYYY-MM-DD' y no como objeto Date (evita corrimientos de zona horaria)
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

module.exports = pool;