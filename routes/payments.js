const express = require("express");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const router = express.Router();

// ✅ Create Payment Intent
router.post("/create-payment-intent", async (req, res) => {
    try {
        const { amount } = req.body;

        if (!amount) return res.status(400).json({ error: "Amount is required." });

        const paymentIntent = await stripe.paymentIntents.create({
            amount,
            currency: "usd",
            payment_method_types: ["card"],
        });

        res.json({ clientSecret: paymentIntent.client_secret });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
