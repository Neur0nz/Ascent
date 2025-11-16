# Android Notification Research

## Current State
- The web client registers the Vite PWA service worker (`/service-worker.js`, built from `web/src/service-worker.ts`) and subscribes to Web Push whenever the browser permission is granted.
- Push subscriptions are stored in `public.web_push_subscriptions` and associated with the authenticated player profile.
- The `submit-move` edge function sends Web Push alerts to the opponent when a move is validated server-side.

## Configuration Checklist
1. Generate VAPID keys (one-time):
   ```bash
   npx web-push generate-vapid-keys
   ```
2. Populate environment variables:
   - Front-end (`web`):
     - `VITE_VAPID_PUBLIC_KEY`
   - Supabase edge functions:
     - `VAPID_PUBLIC_KEY`
     - `VAPID_PRIVATE_KEY`
     - `VAPID_SUBJECT` (e.g. `mailto:support@example.com`)
     - `APP_BASE_URL` (e.g. `https://your-app.example.com`)
3. Deploy the new migration so the `web_push_subscriptions` table exists in production.
4. Redeploy edge functions after supplying the new secrets.

## Behaviour Notes
- Notifications fire when a move is confirmed on the server and the recipient’s browser still has the subscription registered (even if the app is backgrounded).
- If the browser is completely terminated, delivery depends on Android keeping the service worker alive. For guaranteed delivery, ensure the app is installed as a PWA with notifications enabled.
