const Stripe = require('stripe');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let country, city, purpose, nationality, concerns;

  try {
    const { test, session_id } = req.body || {};

    if (test === 'skip') {
      country = String(req.body.country || 'Thailand');
      city = String(req.body.city || 'Bangkok');
      purpose = String(req.body.purpose || 'relocating');
      nationality = String(req.body.nationality || 'American');
      concerns = String(req.body.concerns || '');
    } else {
      if (!session_id) {
        return res.status(400).json({ error: 'Missing session_id' });
      }

      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const session = await stripe.checkout.sessions.retrieve(session_id);

      if (session.payment_status !== 'paid') {
        return res.status(402).json({ error: 'Payment not completed' });
      }

      ({ country, city, purpose, nationality, concerns } = session.metadata);
    }

    const purposeLabel = purpose === 'relocating' ? 'long-term relocation' : 'a tourist visit';

    const prompt = `You are an expert expat advisor with deep firsthand knowledge of living in ${city}, ${country}. Generate a comprehensive, personalized 72-hour survival guide for a ${nationality} national planning ${purposeLabel}.${concerns ? `\n\nTheir specific concerns: ${concerns}` : ''}

Return ONLY a valid JSON object with exactly these 7 keys. Each value must be formatted HTML using only these tags: p, ul, ol, li, strong, em, br. Do not use div, h1, h2, h3, or any other tags.

{
  "checklist": "A numbered HTML list of 12-15 specific priority actions for the first 72 hours. Group by timeframe: use <strong>Day 1 – First Hours:</strong>, <strong>Day 1 – Evening:</strong>, <strong>Day 2:</strong>, <strong>Day 3:</strong> as inline labels. Be very specific to ${city}.",
  "expat_spots": "HTML with specific real names of: 2-3 expat-friendly cafes or bars in ${city}, 1-2 coworking spaces, 2-3 Facebook groups or Reddit communities, and the main expat neighborhood(s). Include brief notes on each.",
  "embassy": "HTML with the ${nationality} embassy or consulate details for ${country}: full street address, main phone number, 24hr emergency hotline, official website URL, opening hours, and a list of key services (passport renewal, notarization, arrests/emergencies, voter registration etc).",
  "sim_card": "HTML guide to mobile connectivity in ${country}: name the top 2-3 carriers for foreigners with monthly cost in local currency, explain exactly where to buy a SIM in ${city} (airport, store name, neighborhood), list required documents, recommend the best data plan, and mention eSIM availability.",
  "banking": "HTML guide for ${nationality} nationals: name 2-3 specific local banks that accept foreign passport holders and what documents they require, typical account opening timeline, ATM network tips, and recommended fintech apps (Wise, Revolut, Payoneer) with specific notes for using them in ${country}.",
  "cost_of_living": "HTML breakdown of real monthly costs: rent (budget/mid-range/expat-level apartment with prices in local currency and USD), daily food cost eating street food vs local restaurants vs cooking, monthly public transport vs taxi/rideshare estimate, utility bills estimate. Give honest ranges, not vague advice.",
  "insider_tips": "HTML numbered list of exactly 7 specific things that genuinely surprise newcomers to ${city}. These should be honest, practical, non-obvious insights — things you only learn after arriving. Avoid generic travel tips."
}

Use real place names, carrier brand names, bank names, and actual price figures. Be honest and specific.`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4096,
        temperature: 0.65,
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error('GROQ error:', groqRes.status, errText);
      throw new Error('AI generation failed. Please try again.');
    }

    const groqData = await groqRes.json();
    let sections;

    try {
      let raw = groqData.choices[0].message.content;
      // Strip markdown code fences if model wrapped the JSON
      raw = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
      sections = JSON.parse(raw);
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr.message);
      throw new Error('Failed to parse guide content. Please try again.');
    }

    const html = buildGuideHTML({ country, city, purpose, nationality, concerns, sections });
    const slug = city.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const filename = `landedtoday-${slug}-guide.html`;

    return res.json({ html, filename, city, country });
  } catch (err) {
    console.error('Generate error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to generate guide' });
  }
};

function buildGuideHTML({ country, city, purpose, nationality, sections }) {
  const purposeLabel = purpose === 'relocating' ? 'Long-term Relocation' : 'Tourist Visit';
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const sectionDefs = [
    { key: 'checklist',     title: 'First 72 Hours Checklist',       icon: '⏱️', accent: '#C4622D' },
    { key: 'expat_spots',   title: 'Where Expats Gather',            icon: '🌍', accent: '#5B7E5A' },
    { key: 'embassy',       title: 'Embassy & Emergency Contacts',   icon: '🏛️', accent: '#2E6E8E' },
    { key: 'sim_card',      title: 'SIM Card & Connectivity',        icon: '📱', accent: '#7B5EA7' },
    { key: 'banking',       title: 'Banking for Foreigners',         icon: '💳', accent: '#8E6B2E' },
    { key: 'cost_of_living',title: 'Cost of Living Reality',         icon: '💰', accent: '#8E3E3E' },
    { key: 'insider_tips',  title: 'What Nobody Tells You',          icon: '🔑', accent: '#3E7B7B' },
  ];

  const sectionsHTML = sectionDefs.map(({ key, title, icon, accent }) => `
    <section class="card">
      <div class="card-header" style="border-left:5px solid ${accent}">
        <span class="card-icon">${icon}</span>
        <h2>${title}</h2>
      </div>
      <div class="card-body">
        ${sections[key] || '<p>Content unavailable for this section.</p>'}
      </div>
    </section>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LandedToday — ${city}, ${country} Survival Guide</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Georgia, serif;
      background: #FAF7F2;
      color: #2D1F14;
      line-height: 1.75;
      font-size: 16px;
    }
    .guide-header {
      background: linear-gradient(135deg, #C4622D 0%, #7B3F1F 100%);
      color: white;
      padding: 3.5rem 2rem 3rem;
      text-align: center;
    }
    .brand {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 2.5px;
      opacity: 0.75;
      margin-bottom: 0.875rem;
    }
    .guide-header h1 {
      font-size: clamp(1.75rem, 4vw, 2.75rem);
      font-weight: 900;
      letter-spacing: -0.5px;
      margin-bottom: 1.25rem;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 0.6rem;
    }
    .meta-pill {
      background: rgba(255,255,255,0.18);
      border: 1px solid rgba(255,255,255,0.3);
      border-radius: 100px;
      padding: 0.3rem 0.9rem;
      font-size: 0.82rem;
    }
    .toc-wrap {
      max-width: 780px;
      margin: 2rem auto 0;
      padding: 0 1.5rem;
    }
    .toc {
      background: white;
      border-radius: 14px;
      padding: 1.5rem 2rem;
      box-shadow: 0 2px 12px rgba(0,0,0,0.06);
    }
    .toc-label {
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #7B6654;
      margin-bottom: 0.875rem;
      font-weight: 600;
    }
    .toc-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 0.4rem 1rem;
    }
    .toc-item { font-size: 0.88rem; color: #4A3728; }
    .guide-body {
      max-width: 780px;
      margin: 0 auto;
      padding: 2rem 1.5rem 4rem;
    }
    .card {
      background: white;
      border-radius: 16px;
      margin-bottom: 1.5rem;
      box-shadow: 0 2px 14px rgba(0,0,0,0.055);
      overflow: hidden;
    }
    .card-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1.125rem 1.75rem;
      background: #FDFAF6;
      border-bottom: 1px solid #F0E8DC;
    }
    .card-icon { font-size: 1.35rem; }
    .card-header h2 {
      font-size: 1.075rem;
      font-weight: 700;
      color: #2D1F14;
    }
    .card-body {
      padding: 1.5rem 1.75rem;
      color: #3D2916;
      font-size: 0.93rem;
    }
    .card-body p { margin-bottom: 0.7rem; }
    .card-body p:last-child { margin-bottom: 0; }
    .card-body ul, .card-body ol {
      padding-left: 1.5rem;
      margin-bottom: 0.7rem;
    }
    .card-body li { margin-bottom: 0.45rem; }
    .card-body strong { color: #1F1209; font-weight: 600; }
    .card-body em { color: #5C3D26; }
    .guide-footer {
      text-align: center;
      padding: 2rem;
      color: #9B8778;
      font-size: 0.78rem;
      border-top: 1px solid #E8D5C4;
    }
    @media print {
      body { background: white; }
      .card { box-shadow: none; border: 1px solid #E0D0C0; page-break-inside: avoid; }
      .guide-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    @media (max-width: 560px) {
      .card-body { padding: 1.25rem; }
    }
  </style>
</head>
<body>
  <header class="guide-header">
    <div class="brand">🌍 LandedToday</div>
    <h1>Your ${city} Survival Guide</h1>
    <div class="meta">
      <span class="meta-pill">📍 ${city}, ${country}</span>
      <span class="meta-pill">🌐 ${nationality} National</span>
      <span class="meta-pill">✈️ ${purposeLabel}</span>
      <span class="meta-pill">📅 ${date}</span>
    </div>
  </header>

  <div class="toc-wrap">
    <div class="toc">
      <div class="toc-label">What's Inside</div>
      <div class="toc-grid">
        <div class="toc-item">⏱️ First 72 Hours Checklist</div>
        <div class="toc-item">🌍 Where Expats Gather</div>
        <div class="toc-item">🏛️ Embassy &amp; Emergency Contacts</div>
        <div class="toc-item">📱 SIM Card &amp; Connectivity</div>
        <div class="toc-item">💳 Banking for Foreigners</div>
        <div class="toc-item">💰 Cost of Living Reality</div>
        <div class="toc-item">🔑 What Nobody Tells You</div>
      </div>
    </div>
  </div>

  <main class="guide-body">
    ${sectionsHTML}
  </main>

  <footer class="guide-footer">
    Generated by LandedToday &middot; ${date} &middot; For personal use only
  </footer>
</body>
</html>`;
}
