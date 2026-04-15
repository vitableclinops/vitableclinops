# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Dev server on http://localhost:8080 (HMR enabled)
npm run build        # Production build
npm run build:dev    # Development build
npm run lint         # ESLint across all .ts/.tsx files
npm test             # Run tests once (Vitest)
npm run test:watch   # Run tests in watch mode
npm run preview      # Preview production build locally
```

## Architecture

**Stack:** React 18 + TypeScript + Vite (SWC) + Tailwind CSS + Supabase

**Path alias:** `@/` maps to `src/`

**Entry point:** `src/main.tsx` → `src/App.tsx` (routing + providers)

### Provider Hierarchy

```
App.tsx
  QueryClientProvider (TanStack React Query)
    AuthProvider (src/hooks/useAuth.tsx)
      BrowserRouter
        Routes (all pages, most wrapped in ProtectedRoute)
```

### Authentication & Authorization

Auth lives in `src/hooks/useAuth.tsx`. It exposes `user`, `session`, `profile`, `roles`, `rolesHydrated`, `loading`, `hasRole()`, and `refreshProfile()`.

Four roles: `admin`, `pod_lead`, `provider`, `physician`. Roles are fetched from the `user_roles` table on login alongside the `profiles` table row.

`ProtectedRoute` (in `src/components/ProtectedRoute.tsx`) accepts an optional `requiredRoles` array. Routes without `requiredRoles` are accessible to any authenticated user. Route-to-role mapping is in `src/App.tsx`.

### Supabase Client

Import the singleton from `@/integrations/supabase/client`. The generated TypeScript types for all tables/views are in `@/integrations/supabase/types`. Database migrations live in `supabase/migrations/`.

```ts
import { supabase } from "@/integrations/supabase/client";
```

### Data Fetching Pattern

All server state uses TanStack React Query (`useQuery`, `useMutation`). Domain-specific hooks in `src/hooks/` encapsulate query/mutation logic and are the preferred place for Supabase calls — pages and components should import these hooks rather than calling `supabase` directly.

### UI Components

shadcn-ui primitives live in `src/components/ui/`. New primitive components should be added there. Feature-level components are organized by domain under `src/components/` (e.g., `agreements/`, `licensure/`, `activation/`).

### Domain Overview

- **Admin Dashboard** (`/admin`) — overview for `admin` and `pod_lead` roles
- **Provider Dashboard** (`/provider`) — task tracking for individual providers
- **State Compliance** (`/admin/states`, `/states/:stateAbbr`) — per-state licensing rules
- **Collaborative Agreements** (`/admin/agreements`) — NP–physician supervision agreements
- **Provider State Grid** (`/grid`) — matrix view of provider × state license status
- **Activation Queue** (`/admin/activation`) — provider credentialing workflow
- **Licensure Application** (`/licensure/:applicationId`) — per-application form flow
- **Hiring Pipeline** (`/admin/hiring`) — recruitment tracking
- **Calendar** (`/admin/calendar`) — scheduling and meeting management
- **Task Repository** (`/admin/tasks`) — reusable task templates

### Key Provider Types

`NP` (Nurse Practitioner) — requires collaborative agreement and prescriptive authority per state  
`RN` (Registered Nurse) — licensure only  
`physician` (MD/DO) — independent practice  
`LPC` — Licensed Professional Counselor  
`mental_health_coach` — unlicensed
