# Gateway to the Realm — Login Redesign

A purely visual / UX polish pass on `src/pages/AuthPage.tsx`. All authentication logic (signIn, signUp, resetPassword, form state, validation, routing) stays exactly as-is. Only markup, classes, and a handful of new CSS utilities change.

## What the user will see

- A deeper, layered dark-fantasy background with a soft radial vignette and faint ambient fog instead of a flat parchment gradient.
- A centered "sealed gateway" card — ornate gold border, soft outer gold glow, inner shadow, backdrop blur — that feels like a parchment panel pressed with wax.
- The existing logo emblem anchored to the **top edge** of the card (overlapping it like a wax seal), with a subtle radial gold glow behind it.
- Title "Wayfarers of Varneth" in Cinzel with the existing gold glow, version chip moved to a small muted line below the card footer.
- Atmospheric supporting copy:
  - Login: "The realm remembers you."
  - Signup: "Begin your tale among the Wayfarers."
  - Reset: "Send a raven to recover your path."
- Inputs with refined focus state: gold ring + subtle outer glow.
- Primary button "Enter the Realm" with a soft gold gradient, hover glow, and a small active/press depression.
- Secondary links (forgot password / toggle mode) styled as muted parchment-gold text, smaller and clearly secondary.
- Subtle entrance: card fades + scales in (~250ms). The emblem's glow gently pulses (very slow, low-amplitude — respects `prefers-reduced-motion`).

## Visual structure

```text
┌──────────────────────────── viewport ────────────────────────────┐
│  layered bg: parchment gradient + radial vignette + fog overlay  │
│                                                                  │
│                    ╭──── emblem (overlap) ────╮                  │
│                    │   logo.png + gold halo   │                  │
│                    ╰──────────┬───────────────╯                  │
│              ┌────────────────┴────────────────┐                 │
│              │  Wayfarers of Varneth (gold)    │                 │
│              │  "The realm remembers you."     │                 │
│              │                                 │                 │
│              │  Email  [_________________]     │                 │
│              │  Pass   [_________________]     │                 │
│              │                                 │                 │
│              │  [   Enter the Realm   ]        │                 │
│              │                                 │                 │
│              │  Forgot password?               │                 │
│              │  No account? Join the Fellowship│                 │
│              └─────────────────────────────────┘                 │
│                         v0.x.y                                   │
└──────────────────────────────────────────────────────────────────┘
```

## Files changed

- **`src/pages/AuthPage.tsx`** — restructure JSX and classes only. No logic changes:
  - Wrap page in a new `gateway-bg` container with a vignette overlay div and an optional fog overlay div.
  - Replace the current `Card` block with a manual sealed-gateway panel (`gateway-card` class) containing:
    - emblem positioned `-top-14`, centered, with `gateway-emblem` glow ring
    - title block with atmospheric subtitle (driven by existing `isLogin` / `isForgotPassword` state)
    - existing `<form>` body unchanged in behavior; inputs get `gateway-input` class for focus polish
    - submit button gets `gateway-btn` class; label becomes "Enter the Realm" / "Create Account" / "Send Reset Link"
    - secondary buttons get `gateway-link` class
  - Move version text to a small muted line beneath the card.
  - Add a single root class `animate-gateway-enter` for fade/scale-in.

- **`src/index.css`** — add new utilities (no token changes):
  - `.gateway-bg` — layered radial gradients (deeper than current `parchment-bg`) + a top/bottom vignette.
  - `.gateway-fog` — absolutely-positioned, low-opacity, slowly drifting radial blobs (pure CSS, GPU-cheap, paused under `prefers-reduced-motion`).
  - `.gateway-card` — `bg-card/80 backdrop-blur` + 1.5px gold border, inner shadow, soft outer gold glow.
  - `.gateway-emblem` — circular radial gold halo behind the logo, very slow pulse keyframe, motion-reduce safe.
  - `.gateway-input` — `focus-visible` gold ring + soft outer glow (extends the existing `Input` styling via className).
  - `.gateway-btn` — gold gradient background, hover lift + glow, `:active` translateY(1px) + dimmer glow.
  - `.gateway-link` — muted gold text, hover brightens to `--gold`.
  - New keyframes: `gateway-enter` (opacity 0 → 1, scale 0.98 → 1, 250ms) and `emblem-pulse` (box-shadow opacity oscillation, 6s, reduced-motion: none).

## Responsive behavior

- Desktop (≥640px): card max-width ~28rem, emblem 96px overlapping top, full atmospheric background.
- Mobile (<640px): card width `w-full` with `mx-4`, emblem shrinks to 72px and sits closer to the card top so it does not crowd inputs; fog overlay hidden via `hidden sm:block` to keep the page light.
- Inputs and button keep `h-10`+ to remain comfortable to tap.

## Explicitly NOT changed

- `useAuth`, Supabase calls, error handling, toasts.
- Form fields, validation, `required`/`minLength`.
- Routing after login.
- Reset password flow logic.
- Database, RLS, edge functions.
- Color tokens in `:root` (only additive utility classes are introduced).

## Acceptance check

- Page still authenticates exactly as before (login, signup, password reset toggle).
- Layout matches the diagram on desktop and stays readable on a 360px-wide phone.
- No new dependencies; no asset additions required (uses existing `@/assets/logo.png`).
- Respects `prefers-reduced-motion` (no pulse, no fog drift, no entrance animation).
