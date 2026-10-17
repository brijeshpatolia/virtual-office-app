# Virtual Office

Virtual Office is a virtual office in the browser for remote teams.
Each person has an avatar on a 2D map of an office.
Later phases add movement, proximity video, a meeting room, chat and screen share.

The client uses Phaser 4 for the map and React 19 for the user interface.
Vite 8 builds the client. TypeScript 6 checks the code.

## Requirements

- Node.js 22.18 or a newer 22.x, Node.js 24, or Node.js 26 or newer. We recommend Node.js 24 (see `.nvmrc`).
  Node.js 23 and 25 are not supported.
- npm 11 or newer. Node.js 24 comes with npm 11. On Node.js 22, run `npm install -g npm@11` first.
  npm 10 rewrites `package-lock.json` in its own format.

Node.js 22.18 and newer can run TypeScript files directly. Some scripts use this.

## Setup

1. Clone the repository.
2. Go to the repository folder.
3. Install the packages:

   ```bash
   npm install
   ```

4. Start the office server and the client together:

   ```bash
   npm run dev
   ```

5. Open http://localhost:8000 in your browser.

You need no accounts and no database for development. The server stores its data in PGlite (Postgres in WebAssembly) in `.data/pglite`.
To sign in, enter any email address. The server prints the sign-in code in its console and appends the mail to `.data/dev-mail.log`.

P1a is in progress: until the auth and realtime work lands, the server stops at start with a `Not implemented` message (see Status).

## Scripts

Run each script from the repository root with `npm run <name>`.

| Script         | What it does                                                                     |
| -------------- | -------------------------------------------------------------------------------- |
| `dev`          | Starts the office server (port 2567) and the client (port 8000) together.        |
| `dev:server`   | Starts only the office server. It restarts when a file changes.                  |
| `dev:client`   | Starts only the client. Vite sends `/api` and `/colyseus` to the office server.  |
| `start`        | Starts the office server without the file watcher.                               |
| `build`        | Builds the client into `apps/client/dist`.                                       |
| `preview`      | Serves the built client on port 8000.                                            |
| `typecheck`    | Checks the types in all workspaces.                                              |
| `lint`         | Runs ESLint. A warning also makes it fail.                                       |
| `test`         | Runs all tests one time with Vitest.                                             |
| `e2e`          | Runs the Playwright tests in `e2e/` against `npm run dev`.                       |
| `db:generate`  | Writes a new SQL migration to `packages/db/drizzle` from the Drizzle schema.     |
| `validate:map` | Checks the office map file (`map.json`) against the map rules.                   |
| `check`        | Runs `typecheck`, `lint`, `test`, `validate:map` and `build`.                    |

Run `npm run check` before you push. GitHub Actions runs the same steps on each push to `main` and on each pull request.

## Folder structure

```
.
├── apps/
│   ├── client/                 Browser client (@vo/client)
│   │   ├── index.html          Vite entry page
│   │   ├── public/assets/map/  Tiled map (map.json) and tileset images
│   │   ├── src/
│   │   │   ├── main.tsx        React entry point
│   │   │   ├── App.tsx         Full-screen layout: the game and the HUD
│   │   │   ├── ui/             React HUD (zone label, debug hint)
│   │   │   └── game/
│   │   │       ├── EventBus.ts       Typed events between React and Phaser
│   │   │       ├── PhaserGame.tsx    Creates and destroys the Phaser game
│   │   │       ├── config.ts         Phaser game settings
│   │   │       ├── depth.ts          Draw order of the tile layers, avatars and debug overlay
│   │   │       ├── readOfficeMap.ts  Parses and validates map.json with @vo/shared
│   │   │       ├── obstacles.ts      Static Arcade bodies from the Collision layer
│   │   │       ├── zoneHover.ts      Zone under the mouse, sent to the HUD
│   │   │       ├── debug/            Map debug overlay
│   │   │       └── scenes/
│   │   │           └── OfficeScene.ts  Builds the office from the map
│   │   └── vite.config.ts      Dev server on port 8000 with the proxy to the office server
│   └── server/                 Office server (@vo/server): Express, Better Auth and Colyseus on one port
│       ├── .env.example        Optional local settings (copy to apps/server/.env)
│       └── src/
│           ├── index.ts        Entry point: reads the environment and starts the server
│           ├── env.ts          Environment variables, checked with zod
│           ├── server.ts       Wires the database, auth, HTTP routes and the office room
│           ├── auth/           Better Auth, realtime token check, office membership
│           ├── mail/           Sign-in codes and invitations (Resend; console and log file in dev)
│           ├── http/           The /api routes
│           └── rooms/          OfficeRoom (one Colyseus room per office) and its synced state
├── packages/
│   ├── db/                     Database (@vo/db): Drizzle schema, migrations, PGlite or Postgres
│   │   ├── src/schema/         Tables (auth.ts is generated by the Better Auth CLI)
│   │   └── drizzle/            SQL migrations, applied when the server starts
│   └── shared/                 Code for the client and the server (@vo/shared)
│       ├── src/
│       │   ├── officeMap.ts    parseOfficeMap: Tiled JSON to an OfficeMap
│       │   ├── zones.ts        zoneAt and ZoneTracker (zone changes with hysteresis)
│       │   ├── grid.ts         Collision grid, line of sight, reachability
│       │   ├── validate.ts     validateOfficeMap: the map rules
│       │   ├── movement.ts     Server move checks
│       │   ├── protocol/       Realtime messages, synced state shape and HTTP API (zod schemas)
│       │   └── cli/validate-map.ts  The validate:map command
│       └── test/
├── .github/workflows/ci.yml    Continuous integration
├── CREDITS.md                  Art credits and license notes
├── eslint.config.js
├── playwright.config.ts        End-to-end tests (e2e/)
├── tsconfig.base.json          TypeScript settings for all workspaces
└── vitest.config.ts
```

The repository uses npm workspaces. Each folder in `apps/` and `packages/` is a workspace.
No workspace has a build step except the client. Node.js runs the server's TypeScript files directly (type stripping), and Vite reads `@vo/shared` directly.
So the code uses only erasable TypeScript syntax: no enums, no namespaces, no parameter properties and no decorators.

The design plan asked for a pnpm 12 workspace. We use npm workspaces on purpose:
npm comes with Node.js, so you and CI need no other tool and no extra setup step.
The folder layout is the same as with pnpm. A later move to pnpm needs only a new lockfile, the CI setup and the `--workspace` flags in the scripts.

## Office server

`apps/server` runs Express (the Better Auth routes under `/api/auth` and the other `/api` routes) and Colyseus on one HTTP server, port 2567.
In development the browser talks only to http://localhost:8000. Vite forwards `/api` to the server, and `/colyseus` (matchmaking and the WebSocket) without the `/colyseus` prefix.

The server reads these environment variables. In development all of them are optional.

| Variable                                    | Default                                    | Notes                                                                    |
| ------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------ |
| `NODE_ENV`                                  | `development`                              | `development`, `test` or `production`.                                   |
| `PORT`                                      | `2567`                                     |                                                                          |
| `CLIENT_ORIGIN`                             | `http://localhost:8000`                    | The only origin that may call the API with cookies.                      |
| `BETTER_AUTH_URL`                           | `CLIENT_ORIGIN`                            | Public origin of `/api/auth`. Required in production.                    |
| `BETTER_AUTH_SECRET`                        | a fixed development value                  | At least 32 characters. Required in production.                          |
| `DATABASE_URL`                              | unset: PGlite                              | Postgres connection string. Required in production.                      |
| `DATA_DIR`                                  | `.data`                                    | PGlite files (`pglite/`) and the dev mail log (`dev-mail.log`).          |
| `PGLITE_DIR`                                | `DATA_DIR/pglite` (tests: `memory://`)     |                                                                          |
| `RESEND_API_KEY`, `EMAIL_FROM`              | unset                                      | Required in production. Development prints mail instead of sending it.   |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`  | unset                                      | Google sign-in is on only when both are set.                             |
| `MAP_PATH`                                  | `../client/public/assets/map/map.json`     | Relative to `apps/server`.                                               |

Put local values in `apps/server/.env` (see `apps/server/.env.example`). The file is not committed.
In production the server refuses to start without the required values. It never prints mail in production.

## How the map works

The office map is a [Tiled](https://www.mapeditor.org/) map: `apps/client/public/assets/map/map.json`.
This JSON file is the only source. There is no `.tmx` file.

The map has 40 x 30 tiles. Each tile is 32 x 32 pixels.
It uses six embedded tilesets. Each tileset has one image.
The game loads each image from the tileset's `image` path in `map.json` (relative to `map.json`), with the tileset name as the texture key.
To add a tileset, put its image in `apps/client/public/assets/map/` (or a folder below it) and add the tileset in Tiled. You do not need to change any code.

The game reads the map in two steps:

1. `parseOfficeMap` (in `@vo/shared`) turns the Tiled JSON into an `OfficeMap` with tilesets, zones, seats, interactables (including doors), colliders and the spawn point.
   It throws an `OfficeMapError` with a list of problems if the file has the wrong structure. The game then does not start.
2. `validateOfficeMap` checks the map rules (see below). The game logs each problem with `console.error`, but still shows the map.

The server (a later phase) will use the same two functions, so the client and the server read the map in the same way.

The camera shows the full map in the center of the window.
It uses the largest whole-number zoom that fits.
If the map does not fit at zoom 1, it uses a smaller zoom.

### Edit the map in Tiled

1. Install Tiled 1.11.
2. In Tiled, open `apps/client/public/assets/map/map.json` directly (File > Open).
3. Make your changes. Follow the rules in the layer contract below.
4. Save with File > Save. Tiled writes the JSON file again. You do not need to export.
5. Check the map:

   ```bash
   npm run validate:map
   ```

   The command prints a summary (zones, seats, computer seats, whiteboards, doors, colliders and spawns) and each problem.
   It exits with code 1 if it finds a problem. CI runs it on each push.

6. Run `npm run dev` and press the key left of 1 (`` ` `` on a US keyboard) to see your zones, seats, doors and colliders on the map.

Keep these Tiled settings:

- Map orientation: orthogonal. Tile size: 32 x 32. The map must not be infinite.
- Tile layer format: CSV. The parser does not read Base64 or compressed layers.
- Tilesets: embedded in the map, one image each. Do not use external `.tsx` tilesets or image collection tilesets.

### Layer contract

The layers, from bottom to top. The game draws the tile layers in this order.
The depth values are in `apps/client/src/game/depth.ts`.

| Layer           | Type         | Depth | What it holds                                                                                                       |
| --------------- | ------------ | ----- | ------------------------------------------------------------------------------------------------------------------- |
| `Ground`        | Tile layer   | 0     | Floors and walls.                                                                                                   |
| `Obj_layer1`    | Tile layer   | 10    | Furniture and decoration.                                                                                           |
| `Obj_layer2`    | Tile layer   | 11    | Furniture and decoration.                                                                                           |
| `Obj_layer3`    | Tile layer   | 12    | Furniture and decoration.                                                                                           |
| `Computers`     | Tile layer   | 20    | Monitors and laptops on desks. Drawn below the avatars.                                                             |
| (avatars)       | -            | 30    | Reserved for the avatars (P1). Not a Tiled layer.                                                                   |
| `Above`         | Tile layer   | 40    | Tiles drawn over the avatars: the meeting-table top row and the pod-b bench top row with the monitor backs.          |
| `Zones`         | Object layer | -     | Rectangles of class `zone`.                                                                                         |
| `Seats`         | Object layer | -     | Points of class `seat`.                                                                                             |
| `Interactables` | Object layer | -     | Rectangles of class `whiteboard`, `signage`, `door` or `stairs`.                                                    |
| `Collision`     | Object layer | -     | Rectangles of class `collider`.                                                                                     |
| `Spawn`         | Object layer | -     | Points of class `spawn`.                                                                                            |

The game does not draw the object layers. It reads them as data.
It draws only the six tile layers above. If you add another tile layer, the game does not draw it and logs a warning.

Object classes and their custom properties:

| Class        | Layer           | Shape     | Properties                                                                                                                                                                    |
| ------------ | --------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zone`       | `Zones`         | Rectangle | `zoneId` (string), `zoneType` (string: `private`, `lobby`, `meeting`, `hallway`, `openplan` or `desk`), `mediaMode` (string: `proximity` or `room`), `capacity` (int, 0 = no limit), `lockable` (bool), `priority` (int) |
| `seat`       | `Seats`         | Point     | `seatId` (string), `zoneId` (string), `facing` (string: `up`, `down`, `left` or `right`), `hasComputer` (bool). A seat with a computer also has `computerCol` and `computerRow` (int): the tile of its own computer sprite. |
| `whiteboard` | `Interactables` | Rectangle | `boardId` (string), `zoneId` (string)                                                                                                                                         |
| `signage`    | `Interactables` | Rectangle | `slotId` (string)                                                                                                                                                             |
| `door`       | `Interactables` | Rectangle | `doorId` (string). Covers the door tiles of one doorway.                                                                                                                      |
| `stairs`     | `Interactables` | Rectangle | `targetFloor` (string, empty for now)                                                                                                                                         |
| `collider`   | `Collision`     | Rectangle | `kind` (string: `wall` or `furniture`). The object name is a label only.                                                                                                      |
| `spawn`      | `Spawn`         | Point     | `spawnId` (string). The map needs exactly one spawn with the id `main`.                                                                                                       |

Map properties: `templateId` (string, for example `startup-hq-40x30`) and `templateVersion` (int, 1 or more).

Tile property: in the tileset, give each monitor and laptop tile the bool property `computer` = true (select the tile in the tileset, then add the property).
Only these tiles count as a seat's computer sprite. Desks, benches and other furniture do not.

Rules for the object layers:

- Write the class in the Class field of the object. Tiled saves it as `type` in the JSON.
- Use only string, int and bool properties. The code reads properties by name, so their order does not matter.
- The ids (`zoneId`, `seatId`, `boardId`, `slotId`, `doorId`, `spawnId`) are stable strings. Never use the Tiled object id or the object order as an id.
- Do not rotate objects. Do not use tile objects, object templates, group layers or layer offsets.
- Zones must not overlap, except when one zone is fully inside another. The inner zone needs a higher `priority`.
- Mark each doorway with a `door` rectangle, and leave the door tiles outside every zone.
- Only `wall` colliders block sound, sight and screen requests. Both kinds block walking. Chairs are not colliders.

`validateOfficeMap` checks these rules:

- The tiles are 32 x 32 px, and all six tile layers exist and match the map size.
- `templateId` and `templateVersion` are set.
- Each id is unique within its kind.
- Each `mediaMode` is `proximity` or `room`.
- Zones are disjoint, or nested with a higher priority for the inner zone.
- Each seat lies in the zone that its `zoneId` names, and not on a wall cell.
- Each seat can be reached from the spawn: a cell within 48 px of the seat is reachable from `main` (walls and furniture block the path).
- Each seat with `hasComputer` names its computer sprite with `computerCol` and `computerRow`.
  That tile is at most 1 tile from the seat, holds a tile with `computer` = true in `Computers` or `Above`, and is not the computer of another seat.
  A seat without `hasComputer` has no `computerCol` and `computerRow`.
- Each whiteboard `zoneId` names a zone.
- No door tile lies in a zone, and no collider covers a door tile.
- There is exactly one spawn `main`, and it is on a free cell.

`parseOfficeMap` also checks the structure: orthogonal map, embedded single-image tilesets with unique names, required layers with the right type, allowed classes per layer, object shapes and property types.

### Map debug overlay

Press the key left of 1 to show or hide the map debug overlay. On a US keyboard this is the backquote key (`` ` ``). A typed `` ` `` also works on other layouts.
Open http://localhost:8000/?debug=1 to show it from the start.

| Color            | Meaning                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------- |
| Fill per type    | Zones: purple private, amber lobby, blue meeting, grey hallway, green open plan, teal desk.   |
| Red              | Wall colliders                                                                                |
| Orange           | Furniture colliders                                                                           |
| White circle     | Seat. The short line shows the direction it faces.                                            |
| Cyan circle      | Seat with a computer                                                                          |
| Pink             | Whiteboards                                                                                   |
| Lavender         | Signage                                                                                       |
| White box        | Doors                                                                                         |
| Brown            | Stairs                                                                                        |
| Green crosshair  | Spawn point                                                                                   |

Each zone, seat, whiteboard, sign and door has a label with its id.

When you move the mouse over the map, the label at the bottom left shows the zone under the mouse and its media mode, for example `meeting-room · room`.
Doors and walls are in no zone, so the label disappears there.

## Status

Phase P0 (new toolchain, the map as data) is done. Phase P1a (walkable multiplayer office and accounts, on one machine) is in progress.

Done in P0:

- Vite 8, TypeScript 6, Phaser 4.2.1 and React 19 in npm workspaces (`apps/client`, `packages/shared`). Arcade gravity is 0.
- The map has the Zones, Seats, Interactables, Collision, Spawn, Computers and Above layers.
  The validator passes: 7 zones, 17 seats (all reachable), 11 computer seats (each linked to its own computer sprite), 3 whiteboards, 3 doors (5 door tiles, all outside every zone), 15 wall and 20 furniture colliders, 1 spawn.
- `@vo/shared`: map parser, zone lookup and zone tracker, line of sight on the wall grid, reachability and the validator, with tests.
- The office scene builds the map from `@vo/shared`, creates the static collision bodies and has the debug overlay and the zone label.
- GitHub Actions runs typecheck, lint, tests, map validation and build.

Still open in P0:

- Art license: buy the LimeZu licenses, remove the six PNG files from the git history and serve them from private storage (see `CREDITS.md`).

Moved to P1:

- The seat and server rules from the design sketches `SeatController.ts` and `serverValidate.ts`: seat claims, the sit radius, server move checks and the screen-request check.
  They go into `@vo/shared` (without Phaser) together with the multiplayer server that uses them.
  P0 ports the map model (`officeMap.ts`), the zones (`ZoneManager.ts`), line of sight and the validator.

P1a so far: the `apps/server` and `packages/db` skeletons, all dependencies, and the shared protocol in `packages/shared/src/protocol` (realtime messages, synced state, HTTP API).
Next in P1a: accounts and companies (Better Auth), the office room (moves, zones, seats, presence), and the client screens and avatars.
P1b: deployment (Fly.io, Neon, Cloudflare Pages, Resend, Google sign-in).

## Art and license

The MIT license in `LICENSE` covers the code only. It does not cover the art.

The six tileset images are art by [LimeZu](https://limezu.itch.io/).
If you use or deploy this project, you must have your own LimeZu license.
See `CREDITS.md` for the details.
