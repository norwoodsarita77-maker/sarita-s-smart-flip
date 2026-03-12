# Netlify Deployment Guide

This application is now configured for easy deployment to Netlify.

## Configuration Files
- `netlify.toml`: Configures the build command, publish directory, and redirects.
- `netlify/functions/api.ts`: Wraps the Express backend as a Netlify Function.

## Deployment Steps
1. Connect your repository to Netlify.
2. Netlify will automatically detect the `netlify.toml` file.
3. Set the following environment variables in the Netlify UI:
   - `SESSION_SECRET`: A random string for session encryption.
   - `STRIPE_SECRET_KEY`: Your Stripe secret key.
   - `STRIPE_WEBHOOK_SECRET`: Your Stripe webhook secret.
   - `RESEND_API_KEY`: Your Resend API key.
   - `GOOGLE_CLIENT_ID`: Your Google OAuth Client ID.
   - `GOOGLE_CLIENT_SECRET`: Your Google OAuth Client Secret.
   - `GEMINI_API_KEY`: Your Gemini API key.
   - `APP_URL`: Your Netlify site URL (e.g., `https://your-site.netlify.app`).

## Database
This app is configured to use **Supabase** (PostgreSQL). 
Ensure you have set the following environment variables in Netlify:
- `SUPABASE_URL`: Your Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key.

The `inventory.db` file is no longer used. Data is persisted in Supabase.
