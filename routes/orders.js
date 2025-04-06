const express = require("express");
const pool = require("../config/db");

const router = express.Router();

// ✅ Test API
router.get("/", (req, res) => {
    res.json({ message: "Backend is working!" });
});

// ✅ Place Order API
router.post("/place_order", async (req, res) => {
    try {
        const { customer_name, items, total_price } = req.body;
        const result = await pool.query(
            "INSERT INTO orders (customer_name, items, total_price, status) VALUES ($1, $2, $3, 'pending') RETURNING id",
            [customer_name, JSON.stringify(items), total_price]
        );
        res.json({ success: true, order_id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ✅ Get Orders API
router.get("/orders", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM orders ORDER BY created_at DESC");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

