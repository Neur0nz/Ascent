# Android Notification Research

## Current State
- The web client is built with Vite/React and currently ships without a service worker or push subscription logic, so no push notifications are delivered on Android (or any platform).
- Supabase does not automatically surface push notifications for client apps. It supplies realtime channels and edge functions, but a push provider must be integrated separately.
- The project has no Firebase or Web Push configuration (no VAPID keys, no worker script), and the existing build pipeline does not register a notification handler.

## Feasibility Notes
- **Web Push (PWA)**: To support Android Chrome notifications we need a service worker that calls `self.addEventListener('push', ...)`, plus client-side subscription management via `registration.pushManager.subscribe`. This requires VAPID key generation and a backend endpoint that stores subscriptions and sends pushes.
- **Native Bridge**: If a native wrapper (e.g. Capacitor/React Native) is introduced, Android push should be implemented through Firebase Cloud Messaging. The current repo has no native shell, so this option would entail additional packaging work.
- **Supabase Integration**: Supabase can trigger webhooks or edge functions after database changes. Those functions can forward events to Web Push or FCM, but the notification transport must be implemented explicitly.

## Recommended Next Steps
1. Decide between PWA Web Push and a native wrapper. For the existing browser target, Web Push is the lighter path.
2. Add a build-time service worker (Vite plugin or manual script) that registers for push notifications and handles display logic.
3. Introduce a backend endpoint (edge function or serverless function) that stores push subscriptions and relays notifications through a provider such as Firebase Cloud Messaging or a Web Push library (e.g. `web-push`).
4. Gate notification prompts behind explicit user consent in the UI once the plumbing is in place.
