const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
    user: process.env.DB_USER || "posgres",
    host: process.env.DB_HOST || "localhost",
    database: process.env.DB_NAME || "pos_db",
    password: process.env.DB_PASS || "2005",
    port: process.env.DB_PORT || 5432,
});

module.exports = pool;
