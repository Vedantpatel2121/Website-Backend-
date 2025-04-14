const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const bodyParser = require("body-parser");
const { Pool } = require("pg");

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

// ✅ Middleware
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

// ✅ PostgreSQL Connection Pool
const pool = new Pool({
  user: process.env.DB_USER || "postgres",
  host: process.env.DB_HOST || "localhost",
  database: process.env.DB_NAME || "pos_db",
  password: process.env.DB_PASSWORD || "2005",
  port: process.env.DB_PORT || 5432,
  ssl: { rejectUnauthorized: false },
});

pool.connect()
  .then(() => console.log("✅ Connected to PostgreSQL Database"))
  .catch((err) => {
    console.error("❌ Database Connection Error:", err.message);
    process.exit(1);
  });

// ✅ Test Route
app.get("/", (req, res) => {
  res.send("✅ Website API is running!");
});

// ✅ Menu Route
app.get("/api/menu", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name, category, price::numeric AS price, image FROM menu ORDER BY id ASC");
    const menuItems = result.rows.map(item => ({
      ...item,
      price: parseFloat(item.price),
      image: item.image || "https://via.placeholder.com/150"
    }));
    res.json(menuItems);
  } catch (error) {
    res.status(500).json({ error: "❌ Failed to fetch menu", details: error.message });
  }
});

// ✅ Order Routes
app.get("/api/orders", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM orders ORDER BY id DESC");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "❌ Failed to fetch orders", details: error.message });
  }
});

app.post("/api/orders", async (req, res) => {
  const { customer_name, order_number, payment_method, total_amount, status } = req.body;
  if (!customer_name || !order_number || !payment_method || !total_amount || !status) {
    return res.status(400).json({ error: "❌ Missing required fields" });
  }

  try {
    const query = `
      INSERT INTO orders (customer_name, order_number, payment_method, total_amount, status, order_date, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING *;
    `;
    const values = [customer_name, order_number, payment_method, total_amount, status];
    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: "❌ Failed to save order", details: error.message });
  }
});

app.delete("/api/orders/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM orders WHERE id = $1 RETURNING *", [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "❌ Order not found!" });
    res.json({ message: "✅ Order deleted successfully", deletedOrder: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: "❌ Failed to delete order", details: error.message });
  }
});

app.get("/api/orders/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT status FROM orders WHERE id = $1", [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "❌ Order not found" });
    res.json({ status: result.rows[0].status });
  } catch (error) {
    res.status(500).json({ error: "❌ Failed to check order status" });
  }
});

app.get("/api/orders/pending", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM orders WHERE status = 'pending' ORDER BY id DESC");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "❌ Failed to fetch pending orders" });
  }
});

// ✅ Reservation (Website → POS-Compatible)
app.post("/api/table-booking", async (req, res) => {
  const { customer_name, phone_number, table_number, start_time, end_time, note, people } = req.body;

  // Extract date and time from start_time
  const booking_date = start_time.split("T")[0]; // YYYY-MM-DD
  const booking_time = start_time.split("T")[1]; // HH:MM:SS

  try {
    await pool.query(`
      INSERT INTO table_booking_
