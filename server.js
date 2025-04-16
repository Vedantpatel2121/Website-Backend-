const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

// ✅ Middleware
app.use(cors({
  origin: ["https://dineease-web.vercel.app"],
  credentials: true
}));
app.use(express.json());
app.use(bodyParser.json());

// ✅ PostgreSQL Pool
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

// ✅ Test route
app.get("/", (req, res) => {
  res.send("✅ Website API is running!");
});

/* ================================
   📋 MENU ROUTES
================================= */
app.get("/api/menu", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name, category, price::numeric AS price FROM menu ORDER BY id ASC");
    const menuItems = result.rows.map(item => ({
      ...item,
      price: parseFloat(item.price),
      image: `https://pos-backend-944m.onrender.com/api/menu/${item.id}/image`
    }));
    res.json(menuItems);
  } catch (error) {
    console.error("❌ Menu error:", error);
    res.status(500).json({ error: "❌ Failed to fetch menu" });
  }
});

/* ================================
   🧾 ORDER ROUTES
================================= */
app.post("/api/orders", async (req, res) => {
  const { customer_name, phone_number, order_number, payment_method, total_amount, status, note, source = "website" } = req.body;

  if (!customer_name || !order_number || !payment_method || !total_amount || !status) {
    return res.status(400).json({ error: "❌ Missing required fields" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO orders (customer_name, phone_number, order_number, payment_method, total_amount, status, order_date, source, note)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8) RETURNING *`,
      [customer_name, phone_number || null, order_number, payment_method, total_amount, status, source, note || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("❌ Order error:", error);
    res.status(500).json({ error: "❌ Failed to save order" });
  }
});

app.get("/api/orders/:id/status", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("SELECT status FROM orders WHERE id = $1", [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "❌ Order not found" });
    res.json({ status: result.rows[0].status });
  } catch (error) {
    res.status(500).json({ error: "❌ Failed to check order status" });
  }
});

/* ================================
   🍽️ TABLE BOOKING
================================= */
app.post("/api/table-booking", async (req, res) => {
  const { customer_name, phone_number, table_number, start_time, end_time, note, people } = req.body;

  if (!customer_name || !phone_number || !table_number || !start_time || !end_time || !people) {
    return res.status(400).json({ message: "❌ Missing required fields" });
  }

  try {
    await pool.query(`
      INSERT INTO table_booking (
        customer_name, phone_number, table_number, status,
        start_time, end_time, note, people
      ) VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7)`,
      [customer_name, phone_number, table_number, start_time, end_time, note, people]
    );
    res.status(200).json({ message: "✅ Reservation saved successfully!" });
  } catch (error) {
    res.status(500).json({ message: "❌ Failed to save reservation", details: error.message });
  }
});

/* ================================
   🕒 AVAILABLE TIME SLOTS
================================= */
app.get("/api/reservations/slots", async (req, res) => {
  const { date, guests } = req.query;

  if (!date || !guests) {
    return res.status(400).json({ error: "Missing date or guests query parameter" });
  }

  const guestCount = parseInt(guests);
  const tableCapacity = {
    1: 4, 2: 4, 3: 4, 4: 4,
    5: 8, 6: 8,
    7: 15,
  };

  const eligibleTables = Object.entries(tableCapacity)
    .filter(([_, cap]) => guestCount <= cap)
    .map(([table]) => parseInt(table));

  const allSlots = [];
  for (let h = 11; h <= 20; h++) {
    ["00", "30"].forEach((m) => {
      if (h === 20 && m === "30") return;
      allSlots.push(`${h.toString().padStart(2, "0")}:${m}`);
    });
  }

  try {
    const result = await pool.query(
      `SELECT table_number, start_time, end_time FROM table_booking WHERE DATE(start_time AT TIME ZONE 'UTC') = $1`,
      [date]
    );

    const bookingsByTable = {};
    result.rows.forEach(({ table_number, start_time, end_time }) => {
      if (!bookingsByTable[table_number]) bookingsByTable[table_number] = new Set();

      const start = new Date(start_time);
      const end = new Date(end_time);
      while (start < end) {
        const hr = String(start.getHours()).padStart(2, "0");
        const min = String(start.getMinutes()).padStart(2, "0");
        bookingsByTable[table_number].add(`${hr}:${min}`);
        start.setMinutes(start.getMinutes() + 30);
      }
    });

    const availableSlots = allSlots.filter((slot) => {
      return eligibleTables.some((table) => {
        const booked = bookingsByTable[table];
        return !(booked && booked.has(slot));
      });
    });

    res.json({ availableSlots });
  } catch (error) {
    console.error("❌ Slot error:", error);
    res.status(500).json({ error: "❌ Failed to fetch available slots" });
  }
});

/* ================================
   💳 STRIPE PAYMENT
================================= */
app.post("/create-payment-intent", async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount) {
      return res.status(400).json({ error: "❌ Amount is required" });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: parseInt(amount),
      currency: "usd",
      automatic_payment_methods: { enabled: true },
    });

    res.status(200).json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error("❌ Stripe error:", error.message);
    res.status(500).json({ error: "❌ Failed to create payment intent", details: error.message });
  }
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`✅ Website Server is running at http://localhost:${PORT}`);
});
