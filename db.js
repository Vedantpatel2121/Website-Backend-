const { Pool } = require("pg");

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "pos_db",
  password: 2005,
  port: 5432, // Default PostgreSQL port
});

pool.on("connect", () => {
  console.log("✅ Connected to PostgreSQL database");
});

module.exports = pool;
