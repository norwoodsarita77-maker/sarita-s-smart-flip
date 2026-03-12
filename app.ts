import express from "express";
import path from "path";
import { OAuth2Client } from "google-auth-library";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import Stripe from "stripe";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import session from "express-session";
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

app.use(session({
  secret: process.env.SESSION_SECRET || 'smartflip-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    sameSite: 'none',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000
  }
}));

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Google OAuth Helper
const getGoogleClient = (req?: express.Request) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  
  let appUrl = process.env.APP_URL;
  if (!appUrl && req) {
    const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    appUrl = `${protocol}://${req.get('host')}`;
  }
  
  if (!clientId || !clientSecret || !appUrl) return null;

  const redirectUri = `${appUrl.replace(/\/$/, '')}/api/auth/google/callback`;
  return new OAuth2Client(clientId, clientSecret, redirectUri);
};

// Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", env: process.env.NODE_ENV, supabaseConfigured: !!supabaseUrl && !!supabaseServiceKey });
});

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !sig || !webhookSecret) return res.status(400).send('Webhook Error: Missing configuration');

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err: any) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userEmail = session.metadata?.userEmail;
    const tier = session.metadata?.tier;

    if (userEmail && tier) {
      let maxLookups = 10;
      if (tier === 'Pro') maxLookups = 100;
      if (tier === 'Unlimited') maxLookups = 999999;

      await supabase
        .from('profiles')
        .update({ subscriptionTier: tier, maxLookups })
        .ilike('email', userEmail);
    }
  }
  res.json({ received: true });
});

app.get("/api/auth/google/url", (req, res) => {
  const client = getGoogleClient(req);
  if (!client) return res.status(500).json({ error: "Google OAuth not configured" });

  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/userinfo.profile", "https://www.googleapis.com/auth/userinfo.email"],
  });
  res.json({ url });
});

app.get("/api/auth/google/callback", async (req, res) => {
  const { code } = req.query;
  const client = getGoogleClient(req);
  if (!client || !code) return res.status(400).send("Invalid request");

  try {
    const { tokens } = await client.getToken(code as string);
    client.setCredentials(tokens);
    const userInfoRes = await client.request({ url: "https://www.googleapis.com/oauth2/v3/userinfo" });
    const userInfo = userInfoRes.data as any;
    const { name, email, picture } = userInfo;
    const cleanEmail = email.toLowerCase();

    const { data: existing } = await supabase
      .from('profiles')
      .select('*')
      .ilike('email', cleanEmail)
      .single();

    if (existing) {
      await supabase
        .from('profiles')
        .update({ name, photo: picture })
        .ilike('email', cleanEmail);
    } else {
      await supabase
        .from('profiles')
        .insert([{ name, email: cleanEmail, photo: picture, subscriptionTier: 'Free', lookupCount: 0, maxLookups: 10 }]);
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .ilike('email', cleanEmail)
      .single();

    res.send(`<html><body><script>if (window.opener) { window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', user: ${JSON.stringify(profile)} }, '*'); window.close(); } else { window.location.href = '/'; }</script></body></html>`);
  } catch (error) {
    res.status(500).send("Authentication failed");
  }
});

app.post("/api/auth/signup", async (req, res) => {
  const { firstName, lastName, email, password } = req.body;
  const cleanEmail = email.toLowerCase();
  
  const { data: existing } = await supabase
    .from('profiles')
    .select('*')
    .ilike('email', cleanEmail)
    .single();

  if (existing) return res.status(400).json({ error: "already exist sign in?" });
  
  const hashedPassword = await bcrypt.hash(password, 10);
  const name = `${firstName} ${lastName}`;
  
  const { data: profile, error } = await supabase
    .from('profiles')
    .insert([{ name, firstName, lastName, email: cleanEmail, password: hashedPassword, subscriptionTier: 'Free', lookupCount: 0, maxLookups: 10 }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(profile);
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const cleanEmail = email.toLowerCase();
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .ilike('email', cleanEmail)
    .single();

  if (!profile || !profile.password || !(await bcrypt.compare(password, profile.password))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  res.json(profile);
});

app.post("/api/auth/forgot-password", async (req, res) => {
  const { email } = req.body;
  const cleanEmail = email.toLowerCase();
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .ilike('email', cleanEmail)
    .single();

  if (!profile) return res.json({ success: true, message: "If an account exists, a reset link has been sent." });

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 3600000).toISOString();
  
  await supabase
    .from('profiles')
    .update({ resetToken: token, resetTokenExpires: expires })
    .ilike('email', cleanEmail);

  const resetLink = `${process.env.APP_URL}/?token=${token}&email=${cleanEmail}`;
  if (resend) {
    await resend.emails.send({
      from: 'SmartFlip <onboarding@resend.dev>',
      to: cleanEmail,
      subject: 'Reset your SmartFlip password',
      html: `<h1>Password Reset Request</h1><p>Click the link below to reset your password:</p><a href="${resetLink}">${resetLink}</a>`
    });
  }
  res.json({ success: true, message: "Reset link sent.", devLink: !resend ? resetLink : undefined });
});

app.post("/api/auth/reset-password", async (req, res) => {
  const { email, token, password } = req.body;
  const cleanEmail = email.toLowerCase();
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('resetToken', token)
    .ilike('email', cleanEmail)
    .single();

  if (!profile || new Date(profile.resetTokenExpires) < new Date()) {
    return res.status(400).json({ error: "Invalid or expired reset token" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  await supabase
    .from('profiles')
    .update({ password: hashedPassword, resetToken: null, resetTokenExpires: null })
    .ilike('email', cleanEmail);

  res.json({ success: true });
});

app.get("/api/profile/:email", async (req, res) => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .ilike('email', req.params.email.toLowerCase())
    .single();
  res.json(profile || null);
});

app.post("/api/profile/increment-lookup", async (req, res) => {
  const email = req.body.email.toLowerCase();
  const { data: profile } = await supabase
    .from('profiles')
    .select('lookupCount')
    .ilike('email', email)
    .single();
  
  if (profile) {
    await supabase
      .from('profiles')
      .update({ lookupCount: (profile.lookupCount || 0) + 1 })
      .ilike('email', email);
  }
  res.json({ success: true });
});

app.post("/api/profile/update-tier", async (req, res) => {
  const { email, tier } = req.body;
  let maxLookups = tier === 'Pro' ? 100 : (tier === 'Unlimited' ? 999999 : 10);
  await supabase
    .from('profiles')
    .update({ subscriptionTier: tier, maxLookups })
    .ilike('email', email.toLowerCase());
  res.json({ success: true });
});

app.post("/api/stripe/create-checkout-session", async (req, res) => {
  if (!stripe) return res.status(500).json({ error: "Stripe is not configured" });
  const { tier, userEmail } = req.body;
  let amount = tier === 'Pro' ? 999 : (tier === 'Unlimited' ? 1999 : 0);
  if (!amount) return res.status(400).json({ error: "Invalid tier" });

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{ price_data: { currency: 'usd', product_data: { name: `Smart Flip ${tier} Plan` }, unit_amount: amount }, quantity: 1 }],
    mode: 'payment',
    success_url: `${process.env.APP_URL}/?payment=success`,
    cancel_url: `${process.env.APP_URL}/?payment=cancel`,
    metadata: { userEmail: userEmail.toLowerCase(), tier }
  });
  res.json({ id: session.id, url: session.url });
});

app.get("/api/inventory", async (req, res) => {
  const userId = (req.query.userId as string)?.toLowerCase();
  if (!userId) return res.status(400).json({ error: "userId required" });
  
  const { data: items } = await supabase
    .from('items')
    .select('*')
    .ilike('userId', userId)
    .order('createdAt', { ascending: false });
    
  res.json(items || []);
});

app.post("/api/inventory", async (req, res) => {
  const { userId, userEmail, name, title, brand, type, condition, purchasePrice, price, averageResalePrice, estimatedProfit, sellThroughRate, marketplace, photo, image, description, status } = req.body;
  const cleanUserId = (userId || userEmail)?.toLowerCase();
  if (!cleanUserId) return res.status(400).json({ error: "userId required" });

  const { data, error } = await supabase
    .from('items')
    .insert([{ 
      userId: cleanUserId, 
      name: name || title || "Untitled", 
      brand: brand || "Unknown", 
      type: type || "Other", 
      condition: condition || "Used", 
      purchasePrice: purchasePrice || price || 0, 
      averageResalePrice: averageResalePrice || price || 0, 
      estimatedProfit: estimatedProfit || 0, 
      sellThroughRate: sellThroughRate || "Unknown", 
      marketplace: marketplace || "eBay", 
      photo: photo || image || "", 
      description: description || "", 
      status: status || 'Draft' 
    }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, id: data.id });
});

app.put("/api/inventory/:id", async (req, res) => {
  const { id } = req.params;
  const { status, soldPrice, shippingCost, marketplaceFee, marketplaceSoldOn, actualProfit } = req.body;
  
  let updateData: any = { status };
  if (status === 'Sold') {
    updateData = { ...updateData, soldPrice, shippingCost, marketplaceFee, marketplaceSoldOn, actualProfit };
  }
  
  await supabase
    .from('items')
    .update(updateData)
    .eq('id', id);
    
  res.json({ success: true });
});

app.get("/api/stats", async (req, res) => {
  const userId = (req.query.userId as string)?.toLowerCase();
  if (!userId) return res.status(400).json({ error: "userId required" });
  
  const { data: items } = await supabase
    .from('items')
    .select('*')
    .ilike('userId', userId);

  if (!items) return res.json({ totalItems: 0, totalProfit: 0, totalListed: 0, totalSold: 0, brandSummary: [], marketplaceSummary: [], totalMilesYTD: 0 });

  const totalItems = items.length;
  const totalProfit = items.reduce((sum, item) => sum + (item.status === 'Sold' ? (item.actualProfit || 0) : (item.estimatedProfit || 0)), 0);
  const totalListed = items.filter(i => i.status === 'Posted').length;
  const totalSold = items.filter(i => i.status === 'Sold').length;

  const brandMap = new Map();
  items.forEach(item => {
    const brand = item.brand || 'Unknown';
    const profit = item.status === 'Sold' ? (item.actualProfit || 0) : (item.estimatedProfit || 0);
    const current = brandMap.get(brand) || { count: 0, profit: 0 };
    brandMap.set(brand, { count: current.count + 1, profit: current.profit + profit });
  });
  const brandSummary = Array.from(brandMap.entries()).map(([brand, data]) => ({ brand, ...data })).sort((a, b) => b.profit - a.profit);

  const marketplaceMap = new Map();
  items.forEach(item => {
    const mp = item.marketplace || 'eBay';
    marketplaceMap.set(mp, (marketplaceMap.get(mp) || 0) + 1);
  });
  const marketplaceSummary = Array.from(marketplaceMap.entries()).map(([marketplace, count]) => ({ marketplace, count }));

  const { data: trips } = await supabase
    .from('trips')
    .select('miles')
    .ilike('userId', userId)
    .like('date', `${new Date().getFullYear()}%`);
    
  const totalMilesYTD = trips?.reduce((sum, trip) => sum + (trip.miles || 0), 0) || 0;

  res.json({ totalItems, totalProfit, totalListed, totalSold, brandSummary, marketplaceSummary, totalMilesYTD });
});

app.get("/api/trips", async (req, res) => {
  const userId = (req.query.userId as string)?.toLowerCase();
  if (!userId) return res.status(400).json({ error: "userId required" });
  
  const { data: trips } = await supabase
    .from('trips')
    .select('*')
    .ilike('userId', userId)
    .order('date', { ascending: false });
    
  res.json(trips || []);
});

app.post("/api/trips", async (req, res) => {
  const { userId, date, startLocation, endLocation, miles, notes } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });
  
  await supabase
    .from('trips')
    .insert([{ userId: userId.toLowerCase(), date, startLocation, endLocation, miles, notes }]);
    
  res.json({ success: true });
});

app.get("/api/admin/users", async (req, res) => {
  const { data: users } = await supabase
    .from('profiles')
    .select('*, items(status, actualProfit, estimatedProfit)')
    .order('createdAt', { ascending: false });

  if (!users) return res.json([]);

  const usersWithStats = users.map(user => {
    const items = user.items || [];
    const itemCount = items.length;
    const totalProfit = items.reduce((sum: number, item: any) => sum + (item.status === 'Sold' ? (item.actualProfit || 0) : (item.estimatedProfit || 0)), 0);
    const { items: _, ...userData } = user;
    return { ...userData, itemCount, totalProfit };
  });

  res.json(usersWithStats);
});

export { app };
