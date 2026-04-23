# Wayfarers of Varneth

A browser-based MUD-style RPG set in the fantasy world of Varneth. Players create characters, explore an interconnected node-based world, engage in real-time combat with creatures, collect loot, and progress through a class-based leveling system.

**Live**: [wayfarersofvarneth.dk](https://wayfarersofvarneth.dk)

## Tech Stack

- **Frontend**: React 18, Vite 5, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Supabase (PostgreSQL, Auth, Edge Functions, Realtime)
- **AI**: Google Gemini via Lovable AI Gateway (world building, item generation)

## Getting Started

```sh
git clone <YOUR_GIT_URL>
cd wayfarers-of-varneth
npm install
npm run dev
```

## Project Structure

```
src/
├── features/          # Feature modules (combat, character, world, party, chat, inventory, creatures)
│   ├── combat/        # Game loop, combat resolver, abilities, buff state
│   ├── character/     # Character panel, stat allocation, status bars
│   ├── world/         # Map, movement, node rendering, teleport
│   ├── party/         # Party management, broadcast sync
│   ├── inventory/     # Equipment, vendor, blacksmith, consumables
│   ├── chat/          # Chat panel, command parser
│   └── creatures/     # Creature hooks, NPC dialog
├── components/
│   ├── admin/         # Admin tools (world editor, item/creature managers, user management)
│   └── ui/            # shadcn/ui component library
├── contexts/          # Game context (central state orchestration)
├── hooks/             # Shared hooks (auth, roles, activity log)
├── lib/               # Utilities (game data formulas, illustration prompts)
└── pages/             # Route pages (game, auth, admin, character creation)

supabase/
├── functions/         # Edge Functions (combat-tick, AI forge, world builder, email)
└── config.toml        # Supabase project configuration
```

## Architecture

- **State ownership**: Server owns simulation state (HP, XP, combat), client owns display and prediction
- **Combat**: Hybrid model — live combat ticks via Edge Functions while players are present, persistent effects on wake-up
- **Realtime**: Supabase Realtime channels for creature state, party sync, and combat broadcasts
- **World**: Three-layer hierarchy (Region → Area → Node) with directional connections

## Admin Access

Admin tools are role-gated with a three-tier hierarchy:

- **Player** — standard game access
- **Steward** — can edit world content (nodes, creatures, areas)
- **Overlord** — full access including user management and dangerous operations

Roles are stored in a dedicated `user_roles` table and checked via a `SECURITY DEFINER` function.
