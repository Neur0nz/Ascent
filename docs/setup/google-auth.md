# Google Sign-In for Supabase

This guide walks you through enabling Google as an authentication provider for the Santorini web client. The frontend already
has a "Continue with Google" button and expects Supabase to handle the OAuth flow, so you only need to complete the console
configuration and restart the dev server with your existing environment variables.

> **Prerequisites**
>
> - Supabase project set up by following [`supabase.md`](./supabase.md)
> - `players` table and policies applied (see the setup guide)
> - Local environment running on `http://localhost:5174` (default Vite dev URL)

## 1. Create a Google Cloud project

1. Visit [https://console.cloud.google.com](https://console.cloud.google.com) and sign in.
2. Select an existing Google Cloud project or create a new one for your Supabase integration.
3. From the left-hand menu open **APIs & Services → OAuth consent screen** and configure:
   - **User Type:** External (required for public sign-ins).
   - Fill in the app name, support email, and developer contact email.
   - Save and continue. You do not need to add scopes beyond the default `email`/`profile` scopes.

## 2. Create OAuth client credentials

1. While still in **APIs & Services**, open **Credentials** and click **Create credentials → OAuth client ID**.
2. Choose **Web application**.
3. Set an identifiable name such as `Santorini Supabase Web`.
4. Under **Authorized JavaScript origins** add your local and production origins, for example:
   - `http://localhost:5174`
   - `https://your-production-domain`
5. Under **Authorized redirect URIs** add the Supabase callback URL:
   - `https://<your-project-ref>.supabase.co/auth/v1/callback`
6. Click **Create**, then copy the **Client ID** and **Client secret**. Keep the modal open or store them securely—you'll paste
   them into Supabase next.

## 3. Enable Google in Supabase

1. Open your Supabase dashboard and go to **Authentication → Providers**.
2. Enable **Google** and paste the Client ID and Client secret from the previous step.
3. Click **Save**. Supabase instantly makes the provider available to the frontend.
4. Confirm the **Site URL** under **Authentication → URL Configuration** matches your local dev URL (e.g.
   `http://localhost:5174`). This must align with the origins you added in Google Cloud so Supabase can redirect users back to
   the app after sign-in.

## 4. Test locally

1. Restart the Vite dev server if it is running: `cd web && npm run dev`.
2. Open the Play tab and click **Continue with Google**. Supabase should redirect you to Google for consent, then back to
   `http://localhost:5174`.
3. After the redirect finishes, the app automatically creates or updates your `players` profile and lets you pick a display
   name from the new profile card.

## 5. Production checklist

- Add your production domain to both the Google OAuth **Authorized JavaScript origins** and Supabase **Site URL**.
- In Google Cloud, publish the OAuth consent screen (move it out of testing mode) before inviting real users.
- Monitor the Supabase auth logs to verify that Google users are signing in successfully.

Once these steps are complete no additional code changes are required—the existing `useSupabaseAuth` hook handles both email
magic links and Google OAuth seamlessly.
