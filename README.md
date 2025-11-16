# 🏛️ Ascent - AlphaZero Santorini

A modern web implementation of Santorini (without god powers) featuring an AlphaZero-style AI opponent. Built with [Vite](https://vitejs.dev/) + [React](https://react.dev/) and [Chakra UI](https://chakra-ui.com/), with client-side game logic powered by [Pyodide](https://pyodide.org/) and [ONNX Runtime Web](https://onnxruntime.ai/).

## 🚀 Quick Start

```bash
# Install dependencies
cd web
npm install

# Start the development server
npm run dev

# The app will be available on http://localhost:5174
# (Port can be changed via VITE_DEV_PORT environment variable)
```

> ℹ️ **First run:** The initial load downloads Pyodide, ONNX Runtime Web, and the Santorini model (~15–20s). Subsequent visits are faster thanks to browser caching.

## 🔐 Online Play Setup (Optional)

The **Practice** tab works offline without any configuration. The **Play** and **Analysis** workspaces require Supabase for:

- Authentication (email magic links and Google OAuth)
- Lobby management and matchmaking
- Match history and analysis
- Push notifications for move alerts

Follow the step-by-step guide in [`docs/setup/supabase.md`](docs/setup/supabase.md) to set up your Supabase project. The guide covers:

- Creating a Supabase project
- Enabling email magic-link authentication
- Applying the database schema (`players`, `matches`, `match_moves`)
- Configuring Row Level Security policies
- Enabling Realtime for live updates
- Setting up environment variables

**Optional:** Enable Google sign-in by following [`docs/setup/google-auth.md`](docs/setup/google-auth.md).

Once configured, create a `web/.env.local` file with your Supabase credentials:

```bash
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Then restart the dev server and open the Play tab to sign in and start playing online.

### Downloading the AI Model

The AlphaZero neural network model is required for AI features (Practice mode with AI opponent, position evaluation). The model file is not included in the repository to keep it lightweight.

Download it from the latest release:

```bash
curl -L -o web/src/assets/santorini/model_no_god.onnx \
  https://github.com/cestpasphoto/alpha-zero-general-santorini/releases/latest/download/model_no_god.onnx
```

Alternatively, you can download it manually from the [releases page](https://github.com/cestpasphoto/alpha-zero-general-santorini/releases) and place it in `web/src/assets/santorini/model_no_god.onnx`.

**Note:** The Practice tab will work for human vs human games without the model, but AI features require this file.

## 🧩 Features

### Practice Mode (Offline)
- Play against an AlphaZero-style AI opponent
- Adjustable difficulty via MCTS simulation count
- Human vs human local games
- Position evaluation and move analysis
- Undo/redo support
- Move history and game state persistence

### Online Play (Requires Supabase)
- Create and join public or private matches
- Real-time matchmaking lobby
- Clock-based games with time controls
- Match history and replay analysis
- Push notifications for move alerts
- Player profiles and ratings

### Analysis Tools
- Position evaluation bar
- Top-move explorer with probabilities
- Move history viewer
- Game replay and analysis

## 🛠️ Development

The project uses a modern Vite + React + TypeScript stack. The main application lives in the `web/` directory.

### Getting Started

```bash
# Install dependencies
cd web
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Build for production without compiling the Rust/WASM bundle
npm run build:no-rust

# Preview production build
npm run preview

# Run tests
npm test
```

### Project Structure

```
.
├── web/                      # Main application (Vite + React)
│   ├── src/                  # TypeScript/React source code
│   │   ├── components/       # React components
│   │   ├── hooks/            # Custom React hooks
│   │   ├── game/             # Game logic and utilities
│   │   ├── lib/              # Shared libraries and utilities
│   │   └── types/            # TypeScript type definitions
│   ├── public/               # Static assets (favicon, service workers)
│   ├── src/assets/           # Source assets (processed by Vite)
│   │   └── santorini/        # Python AI engine + ONNX model
│   └── dist/                 # Production build output
├── shared/                    # Shared TypeScript game engine
│   └── santoriniEngine.ts    # Used by both web and Supabase functions
├── supabase/                 # Supabase configuration
│   ├── functions/            # Edge functions (Deno)
│   └── migrations/           # Database migrations
├── scripts/                    # Utility scripts
│   ├── deploy-functions.sh    # Deploy all Supabase functions
│   └── manage-functions.sh    # Manage Supabase functions
├── docs/                        # Documentation
│   ├── setup/                  # Setup guides
│   ├── development/            # Development guidelines
│   └── technical-debt.md       # Technical debt tracking
└── rust-wasm/                  # Rust/WASM implementation (work in progress)
```

### Key Files

- `web/src/App.tsx` – Main application component and routing
- `web/src/hooks/useSantorini.tsx` – Pyodide/ONNX orchestration for AI features
- `web/src/hooks/useOnlineSantorini.ts` – Online game state management
- `web/src/hooks/useLocalSantorini.ts` – Local game state management
- `shared/santoriniEngine.ts` – Shared TypeScript game engine (client + server)
- `web/src/game/` – Game board rendering and interaction logic
- `supabase/functions/` – Server-side move validation and match management

### Architecture Notes

- **Game Engine:** The TypeScript engine in `shared/santoriniEngine.ts` handles all game logic for both client and server. Python (via Pyodide) is only used for AI features (MCTS + ONNX model inference).
- **Python Integration:** Python files in `web/src/assets/santorini/` are imported via Vite and loaded dynamically by Pyodide at runtime. The model (`model_no_god.onnx`) should be placed in the same directory.
- **Supabase Functions:** Edge functions validate moves server-side using the same TypeScript engine to ensure consistency.

## 🧪 Testing

Run the test suite with:

```bash
cd web
npm test
```

Tests use Vitest with jsdom. Add new test files in `__tests__` directories next to the files they test.

## 🚢 Deployment

The Vite build produces static assets in `web/dist/` that can be deployed to any static hosting provider.

### Building for Production

```bash
cd web
npm run build
```

The production bundle will be in `web/dist/`. Deploy this directory to:

- **GitHub Pages** – Use GitHub Actions to build and deploy on push
- **Supabase Hosting** – Use `supabase deploy` for integrated hosting
- **Vercel/Netlify** – Connect the repository for automatic deployments
- **Any static host** – Upload the `dist/` directory contents

### Environment Variables

For production, set these environment variables:

**Required for AI features:**
- `VITE_PYODIDE_URL` – URL to Pyodide runtime (default CDN works)
- `VITE_ONNX_URL` – URL to ONNX Runtime Web (default CDN works)

**Required for online play:**
- `VITE_SUPABASE_URL` – Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` – Your Supabase anonymous key

**Optional:**
- `VITE_PUBLIC_BASE_PATH` – Base path if deploying to a subdirectory
- `VITE_VAPID_PUBLIC_KEY` – For push notifications (see [`docs/setup/android-notifications.md`](docs/setup/android-notifications.md))

### Supabase Edge Functions

Deploy edge functions to Supabase:

```bash
# Using the management script
./scripts/manage-functions.sh deploy

# Or manually
npx supabase functions deploy create-match
npx supabase functions deploy submit-move
npx supabase functions deploy update-match-status
```

See [`docs/development/guidelines.md`](docs/development/guidelines.md) for more details on development workflows and conventions.

## 📚 Documentation

- **Setup Guides:**
  - [`docs/setup/supabase.md`](docs/setup/supabase.md) – Complete Supabase setup guide
  - [`docs/setup/google-auth.md`](docs/setup/google-auth.md) – Google OAuth configuration
  - [`docs/setup/android-notifications.md`](docs/setup/android-notifications.md) – Push notification setup
- **Development:**
  - [`docs/development/guidelines.md`](docs/development/guidelines.md) – Development guidelines and conventions
- **Technical:**
  - [`docs/technical-debt.md`](docs/technical-debt.md) – Known technical debt and improvement areas

## 🤝 Contributing

Contributions are welcome! Please read [`docs/development/guidelines.md`](docs/development/guidelines.md) for development guidelines, coding standards, and testing requirements.

## 📝 License

This project inherits the original license from [`alpha-zero-general`](https://github.com/suragnair/alpha-zero-general). See [LICENSE](LICENSE) for details.
