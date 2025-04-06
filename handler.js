require("dotenv").config();
const { Pool } = require("pg");

// ✅ PostgreSQL Database Connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: 5432,
});

// ✅ Store Order in Database
module.exports.processOrder = async (event) => {
  try {
    const { customer_name, order_items, total_price, payment_status } = JSON.parse(event.body);

    const query = `
      INSERT INTO orders (customer_name, order_items, total_price, payment_status, order_date)
      VALUES ($1, $2, $3, $4, NOW()) RETURNING *;
    `;
    const values = [customer_name, JSON.stringify(order_items), total_price, payment_status];

    const result = await pool.query(query, values);

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: "✅ Order placed successfully!", order: result.rows[0] }),
    };
  } catch (error) {
    console.error("❌ Error storing order:", error);

    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: "Failed to store order", details: error.message }),
    };
  }
};

// ✅ Fetch All Orders (Optional)
module.exports.getOrders = async () => {
  try {
    const result = await pool.query("SELECT * FROM orders ORDER BY order_date DESC");

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(result.rows),
    };
  } catch (error) {
    console.error("❌ Error fetching orders:", error);

    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: "Failed to fetch orders", details: error.message }),
    };
  }
};

// ✅ Health Check Endpoint (Optional)
module.exports.healthCheck = async () => {
  return {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify({ message: "Server is running 🚀" }),
  };
};
