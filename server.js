const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const bodyParser = require("body-parser");
const { Pool } = require("pg");

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

// ✅ Middleware (Ensures JSON handling & CORS support)
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

// ================================
// ✅ TEST API Route
// ================================
app.get("/", (req, res) => {
  res.send("✅ Website API is running!");
});

// ================================
// ✅ MENU MANAGEMENT ROUTES
// ================================
app.get("/api/menu", async (req, res) => {
  try {
    console.log("🔍 Fetching all menu items...");
    const result = await pool.query("SELECT id, name, category, price::numeric AS price, image FROM menu ORDER BY id ASC");
    const menuItems = result.rows.map(item => ({
      ...item,
      price: parseFloat(item.price),
      image: item.image || "https://via.placeholder.com/150"
    }));
    res.json(menuItems);
  } catch (error) {
    console.error("❌ Error fetching menu:", error);
    res.status(500).json({ error: "❌ Failed to fetch menu", details: error.message });
  }
});

// ================================
// ✅ ORDER MANAGEMENT ROUTES
// ================================
app.get("/api/orders", async (req, res) => {
  try {
    console.log("🔍 Fetching all orders...");
    const result = await pool.query("SELECT * FROM orders ORDER BY id DESC");
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error fetching orders:", error);
    res.status(500).json({ error: "❌ Failed to fetch orders", details: error.message });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    console.log("📩 Received Order Request:", req.body);
    const { customer_name, order_number, payment_method, total_amount, status } = req.body;

    if (!customer_name || !order_number || !payment_method || !total_amount || !status) {
      return res.status(400).json({ error: "❌ Missing required fields", receivedData: req.body });
    }

    const query = `
      INSERT INTO orders (customer_name, order_number, payment_method, total_amount, status, order_date, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING *;
    `;
    const values = [customer_name, order_number, payment_method, total_amount, status];

    const result = await pool.query(query, values);
    console.log("✅ Order Saved:", result.rows[0]);
    res.status(201).json(result.rows[0]);

  } catch (error) {
    console.error("❌ Database Error:", error);
    res.status(500).json({ error: "❌ Failed to save order", details: error.message });
  }
});

app.delete("/api/orders/:id", async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🗑️ Deleting Order ID: ${id}`);

    const result = await pool.query("DELETE FROM orders WHERE id = $1 RETURNING *", [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "❌ Order not found!" });
    }

    console.log("✅ Order Deleted:", result.rows[0]);
    res.json({ message: "✅ Order deleted successfully", deletedOrder: result.rows[0] });

  } catch (error) {
    console.error("❌ Error deleting order:", error);
    res.status(500).json({ error: "❌ Failed to delete order", details: error.message });
  }
});

// ✅ GET Order Status by ID (Polling support)
app.get("/api/orders/:id/status", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("SELECT status FROM orders WHERE id = $1", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "❌ Order not found" });
    }
    res.json({ status: result.rows[0].status });
  } catch (error) {
    console.error("❌ Error checking order status:", error);
    res.status(500).json({ error: "❌ Failed to check order status" });
  }
});

// ✅ NEW: Get All Pending Orders (for POS)
app.get("/api/orders/pending", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM orders WHERE status = 'pending' ORDER BY id DESC");
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error fetching pending orders:", error);
    res.status(500).json({ error: "❌ Failed to fetch pending orders" });
  }
});

// ================================
// ✅ START SERVER
// ================================
app.listen(PORT, () => {
  console.log(`✅ Website Server is running at http://localhost:${PORT}`);
});
