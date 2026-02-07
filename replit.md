# DentalAI - AI Receptionist for Dental Clinics

## Overview

DentalAI is an AI-powered receptionist system for dental clinics that automates appointment booking through chat and voice interfaces. The application supports multiple doctors, syncs with Google Calendar, and provides separate admin and doctor portals for clinic management.

Key capabilities:
- AI chat widget for patient appointment booking (English & Dutch)
- Appointment reschedule/cancel via chat with reference number + phone verification
- Admin dashboard for managing doctors, patients, and appointments
- Doctor portal for viewing schedules and managing availability
- Session-based authentication with role-based access control (admin/doctor)
- OpenAI integration for conversational AI features

### Appointment Reference Numbers
- Every appointment gets a unique reference number (APT-XXXX) on creation
- Generated with alphanumeric characters (excluding ambiguous ones like 0/O/1/I/L)
- Used for secure appointment lookup in reschedule/cancel flows
- Phone verification required alongside reference number to prevent unauthorized access
- Reference numbers displayed in admin and doctor appointment cards

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight router)
- **State Management**: TanStack React Query for server state
- **UI Components**: shadcn/ui with Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming (light/dark mode)
- **Build Tool**: Vite with HMR support

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ESM modules)
- **API Pattern**: RESTful JSON APIs under `/api/*` prefix
- **Session Management**: express-session with PostgreSQL session store (connect-pg-simple)
- **Authentication**: Username/password with bcryptjs, role-based access (admin/doctor)

### Database Layer
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM with drizzle-zod for schema validation
- **Schema Location**: `shared/schema.ts` with models split into `shared/models/`
- **Migrations**: Drizzle Kit with `db:push` command

### Key Data Models
- **Users/Sessions**: Replit Auth compatible session storage
- **Doctors**: Linked to user accounts, includes Google Calendar integration fields
- **Patients**: Contact information and notes
- **Appointments**: Links patients to doctors with scheduling data
- **DoctorAvailability**: Weekly availability slots per doctor
- **ChatSessions/ChatMessages**: AI conversation history
- **AdminUsers**: Credential-based admin/doctor accounts

### AI Integration
- OpenAI API via Replit AI Integrations
- Server-side AI routes in `server/replit_integrations/`
- Audio processing utilities for voice features (speech-to-text, text-to-speech)
- Streaming responses via Server-Sent Events (SSE)

### Authentication Flow
1. Session-based auth with PostgreSQL-backed session store
2. Login via `/api/auth/login` with username/password
3. Role stored in session: `admin` (full access) or `doctor` (limited access)
4. Middleware functions: `requireAuth`, `requireAdmin`, `requireDoctor`

### Project Structure
```
client/               # React frontend
  src/
    components/       # UI components including shadcn/ui
    pages/            # Route pages (admin/*, doctor/*, chat, login)
    hooks/            # Custom React hooks
    lib/              # Utilities and query client
server/               # Express backend
  middleware/         # Express middleware
    auth.ts           # requireAuth, requireAdmin, requireDoctor
  services/           # Shared services
    openai.ts         # OpenAI client instance
  routes/             # Modular route handlers
    index.ts          # Main route registration (wires all modules)
    admin.ts          # Admin CRUD routes (/api/admin/*)
    public.ts         # Public-facing routes (/api/public/*)
    doctor/           # Doctor routes
      index.ts        # Profile, appointments, availability (/api/doctor/*)
      calendar.ts     # Google Calendar OAuth & sync (/api/doctor/calendar/*)
    chat/             # AI chat routes
      index.ts        # Re-export
      handlers.ts     # Route handlers (session, message, message-simple)
      tools.ts        # OpenAI function/tool definitions
      prompts.ts      # System prompt builders (EN/NL)
      availability.ts # Slot availability logic
      quickReplies.ts # Quick reply button logic
  replit_integrations/ # AI, auth setup modules
  google-calendar.ts  # Google Calendar API helpers
shared/               # Shared types and database schema
  models/             # Drizzle table definitions
  schema.ts           # Main schema exports
```

## External Dependencies

### Database
- **PostgreSQL**: Primary database via `DATABASE_URL` environment variable
- **connect-pg-simple**: Session storage in PostgreSQL

### AI Services
- **OpenAI API**: Chat completions, speech-to-text, text-to-speech
- Environment variables: `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`

### Third-Party Integrations
- **Google Calendar**: Optional sync for doctor schedules (fields exist for OAuth tokens)
- **ffmpeg**: Required for WebM to WAV audio conversion (available on Replit)

### Key NPM Packages
- `drizzle-orm` / `drizzle-kit`: Database ORM and migrations
- `express-session`: Session management
- `bcryptjs`: Password hashing
- `openai`: OpenAI API client
- `@tanstack/react-query`: Data fetching and caching
- `wouter`: Client-side routing
- `zod`: Schema validation