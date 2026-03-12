# Vercel Deployment Guide

This application is now configured for easy deployment to Vercel.

## Configuration Files
- `vercel.json`: Configures the routing and rewrites.
- `api/index.ts`: Exports the Express backend for Vercel's Serverless Functions.

## Deployment Steps
1. Connect your repository to Vercel.
2. Vercel will automatically detect the project as a Vite app.
3. Set the following environment variables in the Vercel Dashboard:
   - `SESSION_SECRET`: A random string for session encryption.
   - `STRIPE_SECRET_KEY`: Your Stripe secret key.
   - `STRIPE_WEBHOOK_SECRET`: Your Stripe webhook secret.
   - `RESEND_API_KEY`: Your Resend API key.
   - `GOOGLE_CLIENT_ID`: Your Google OAuth Client ID.
   - `GOOGLE_CLIENT_SECRET`: Your Google OAuth Client Secret.
   - `GEMINI_API_KEY`: Your Gemini API key.
   - `APP_URL`: Your Vercel deployment URL (e.g., `https://your-site.vercel.app`).

## Important Note on Database
This app currently uses **SQLite** (`better-sqlite3`). 
**SQLite is not persistent on Vercel Serverless Functions.** 
Every time the function starts or scales, the database will be reset to its initial state (or empty).

**Recommendation for Production:**
For a persistent database on Vercel, you should use a managed database provider. Vercel has great integrations with:
- **Vercel Postgres** (Neon)
- **Supabase**
- **MongoDB Atlas**
- **PlanetScale**

You will need to update `app.ts` to use the client library for your chosen database instead of `better-sqlite3`.
