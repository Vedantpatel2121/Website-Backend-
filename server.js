const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: ["https://dineease-web.vercel.app", "http://localhost:3000"],
  credentials: true
}));
app.use(express.json());
app.use(bodyParser.json());

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

app.get("/", (req, res) => {
  res.send("✅ Website API is running!");
});

// ✅ Menu
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
    res.status(500).json({ error: "❌ Failed to fetch menu", details: error.message });
  }
});

// ✅ Orders
app.get("/api/orders", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM orders ORDER BY id DESC");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "❌ Failed to fetch orders", details: error.message });
  }
});

app.post("/api/orders", async (req, res) => {
  const {
    customer_name, phone_number, order_number, payment_method,
    total_amount, status, note, source, items
  } = req.body;

  if (!customer_name || !phone_number || !order_number || !payment_method || !total_amount || !status) {
    return res.status(400).json({ error: "❌ Missing required fields" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orderQuery = `
      INSERT INTO orders (customer_name, phone_number, order_number, payment_method, total_amount, status, order_date, created_at, note, source)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), $7, $8) RETURNING id;
    `;
    const orderValues = [customer_name, phone_number, order_number, payment_method, total_amount, status, note || null, source || 'online'];
    const orderResult = await client.query(orderQuery, orderValues);
    const orderId = orderResult.rows[0].id;

    if (Array.isArray(items)) {
      for (const item of items) {
        await client.query(
          "INSERT INTO order_items (order_id, item_name, quantity, price) VALUES ($1, $2, $3, $4)",
          [orderId, item.name, item.quantity, item.price]
        );
      }
    }

    await client.query("COMMIT");
    res.status(201).json({ message: "✅ Order and items saved", orderId });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "❌ Failed to save order", details: error.message });
  } finally {
    client.release();
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

// ✅ Table Booking (with booking_date & booking_time fix)
app.post("/api/table-booking", async (req, res) => {
  const { customer_name, phone_number, table_number, start_time, end_time, note, people } = req.body;

  if (!customer_name || !phone_number || !table_number || !start_time || !end_time || !people) {
    return res.status(400).json({ message: "❌ Missing required fields" });
  }

  try {
    const start = new Date(start_time);
    const booking_date = start.toISOString().split("T")[0];
    const booking_time = start.toISOString().split("T")[1].slice(0, 5); // HH:MM

    await pool.query(`
      INSERT INTO table_booking (
        customer_name, phone_number, table_number, booking_date,
        booking_time, start_time, end_time, note, people
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      customer_name,
      phone_number,
      table_number,
      booking_date,
      booking_time,
      start_time,
      end_time,
      note,
      people
    ]);

    res.status(200).json({ message: "✅ Reservation saved successfully!" });
  } catch (error) {
    res.status(500).json({ message: "❌ Failed to save reservation", details: error.message });
  }
});

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
    .filter(([_, capacity]) => guestCount <= capacity)
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch available slots" });
  }
});

// ✅ Stripe
app.post("/create-payment-intent", async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount) return res.status(400).json({ error: "❌ Amount is required" });

    const paymentIntent = await stripe.paymentIntents.create({
      amount: parseInt(amount),
      currency: "usd",
      automatic_payment_methods: { enabled: true }
    });

    res.status(200).json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error("❌ Stripe Error:", error.message);
    res.status(500).json({ error: "❌ Failed to create payment intent", details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Website Server is running at http://localhost:${PORT}`);
});
