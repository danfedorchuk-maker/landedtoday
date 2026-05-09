const Stripe = require('stripe');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { country, city, purpose, nationality, concerns } = req.body || {};

  if (!country || !city || !purpose || !nationality) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: process.env.STRIPE_PRICE_US, quantity: 1 }],
      mode: 'payment',
      success_url: `${process.env.BASE_URL}/?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/?cancelled=true`,
      metadata: {
        country: String(country).slice(0, 100),
        city: String(city).slice(0, 100),
        purpose: String(purpose).slice(0, 50),
        nationality: String(nationality).slice(0, 100),
        concerns: String(concerns || '').slice(0, 490),
      },
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
