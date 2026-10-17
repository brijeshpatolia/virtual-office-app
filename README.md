# Virtual Office

Virtual Office is a virtual office in the browser for remote teams.
Each person has an avatar on a 2D map of an office.
Later phases add movement, proximity video, a meeting room, chat and screen share.

The client uses Phaser 4 for the map and React 19 for the user interface.
Vite 8 builds the client. TypeScript 6 checks the code.

## Requirements

- Node.js 22.18 or newer. We recommend Node.js 24 (see `.nvmrc`).
- npm 10 or newer. npm comes with Node.js.

Node.js 22.18 and newer can run TypeScript files directly. Some scripts use this.

## Setup

1. Clone the repository.
2. Go to the repository folder.
3. Install the packages:

   ```bash
   npm install
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Open http://localhost:8000 in your browser.

## Scripts

Run each script from the repository root with `npm run <name>`.

| Script         | What it does                                                        |
| -------------- | ------------------------------------------------------------------- |
| `dev`          | Starts the client development server on port 8000.                  |
| `build`        | Builds the client into `apps/client/dist`.                          |
| `preview`      | Serves the built client on port 8000.                               |
| `typecheck`    | Checks the types in all workspaces.                                 |
| `lint`         | Runs ESLint. A warning also makes it fail.                          |
| `test`         | Runs all tests one time with Vitest.                                |
| `validate:map` | Checks the office map file (`map.json`) against the map rules.      |
| `check`        | Runs `typecheck`, `lint`, `test`, `validate:map` and `build`.       |

Run `npm run check` before you push. GitHub Actions runs the same steps on each push to `main` and on each pull request.

## Folder structure

```
.
├── apps/
│   └── client/                 Browser client (@vo/client)
│       ├── index.html          Vite entry page
│       ├── public/assets/map/  Tiled map (map.json) and tileset images
│       ├── src/
│       │   ├── main.tsx        React entry point
│       │   ├── App.tsx         Full-screen layout: the game and the HUD
│       │   ├── ui/             React HUD (zone label, debug hint)
│       │   └── game/
│       │       ├── EventBus.ts       Typed events between React and Phaser
│       │       ├── PhaserGame.tsx    Creates and destroys the Phaser game
│       │       ├── config.ts         Phaser game settings
│       │       ├── depth.ts          Draw order of the tile layers, avatars and debug overlay
│       │       ├── readOfficeMap.ts  Parses and validates map.json with @vo/shared
│       │       ├── obstacles.ts      Static Arcade bodies from the Collision layer
│       │       ├── zoneHover.ts      Zone under the mouse, sent to the HUD
│       │       ├── debug/            Map debug overlay
│       │       └── scenes/
│       │           └── OfficeScene.ts  Builds the office from the map
│       └── vite.config.ts
├── packages/
│   └── shared/                 Code for the client and the server (@vo/shared)
│       ├── src/
│       │   ├── officeMap.ts    parseOfficeMap: Tiled JSON to an OfficeMap
│       │   ├── zones.ts        zoneAt and ZoneTracker (zone changes with hysteresis)
│       │   ├── grid.ts         Collision grid, line of sight, reachability
│       │   ├── validate.ts     validateOfficeMap: the map rules
│       │   └── cli/validate-map.ts  The validate:map command
│       └── test/
├── .github/workflows/ci.yml    Continuous integration
├── CREDITS.md                  Art credits and license notes
├── eslint.config.js
├── tsconfig.base.json          TypeScript settings for all workspaces
└── vitest.config.ts
```

The repository uses npm workspaces. Each folder in `apps/` and `packages/` is a workspace.
`@vo/shared` has no build step. Vite and Node.js read its TypeScript files directly.

## How the map works

The office map is a [Tiled](https://www.mapeditor.org/) map: `apps/client/public/assets/map/map.json`.
This JSON file is the only source. There is no `.tmx` file.

The map has 40 x 30 tiles. Each tile is 32 x 32 pixels.
It uses six embedded tilesets.
The game loads each tileset image with a texture key that is equal to the tileset name in Tiled.
If you add a tileset, you must also add its name to `TILESET_IMAGES` in `OfficeScene.ts`.

The game reads the map in two steps:

1. `parseOfficeMap` (in `@vo/shared`) turns the Tiled JSON into an `OfficeMap` with zones, seats, interactables, colliders and the spawn point.
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

   The command prints a summary (zones, seats, computer seats, whiteboards, colliders and spawns) and each problem.
   It exits with code 1 if it finds a problem. CI runs it on each push.

6. Run `npm run dev` and press the backquote key (`` ` ``) to see your zones, seats and colliders on the map.

Keep these Tiled settings:

- Map orientation: orthogonal. Tile size: 32 x 32. The map must not be infinite.
- Tile layer format: CSV. The parser does not read Base64 or compressed layers.
- Tilesets: embedded in the map. Do not use external `.tsx` tilesets.

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
| `Interactables` | Object layer | -     | Rectangles of class `whiteboard`, `signage` or `stairs`.                                                            |
| `Collision`     | Object layer | -     | Rectangles of class `collider`.                                                                                     |
| `Spawn`         | Object layer | -     | Points of class `spawn`.                                                                                            |

The game does not draw the object layers. It reads them as data.
It draws only the six tile layers above. If you add another tile layer, the game does not draw it and logs a warning.

Object classes and their custom properties:

| Class        | Layer           | Shape     | Properties                                                                                                                                                                    |
| ------------ | --------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zone`       | `Zones`         | Rectangle | `zoneId` (string), `zoneType` (string: `private`, `lobby`, `meeting`, `hallway`, `openplan` or `desk`), `mediaMode` (string: `proximity` or `room`), `capacity` (int, 0 = no limit), `lockable` (bool), `priority` (int) |
| `seat`       | `Seats`         | Point     | `seatId` (string), `zoneId` (string), `facing` (string: `up`, `down`, `left` or `right`), `hasComputer` (bool)                                                                 |
| `whiteboard` | `Interactables` | Rectangle | `boardId` (string), `zoneId` (string)                                                                                                                                         |
| `signage`    | `Interactables` | Rectangle | `slotId` (string)                                                                                                                                                             |
| `stairs`     | `Interactables` | Rectangle | `targetFloor` (string, empty for now)                                                                                                                                         |
| `collider`   | `Collision`     | Rectangle | `kind` (string: `wall` or `furniture`). The object name is a label only.                                                                                                      |
| `spawn`      | `Spawn`         | Point     | `spawnId` (string). The map needs exactly one spawn with the id `main`.                                                                                                       |

Map properties: `templateId` (string, for example `startup-hq-40x30`) and `templateVersion` (int, 1 or more).

Rules for the object layers:

- Write the class in the Class field of the object. Tiled saves it as `type` in the JSON.
- Use only string, int and bool properties. The code reads properties by name, so their order does not matter.
- The ids (`zoneId`, `seatId`, `boardId`, `slotId`, `spawnId`) are stable strings. Never use the Tiled object id or the object order as an id.
- Do not rotate objects. Do not use tile objects, object templates, group layers or layer offsets.
- Zones must not overlap, except when one zone is fully inside another. The inner zone needs a higher `priority`.
- Leave the door tiles outside every zone.
- Only `wall` colliders block sound, sight and screen requests. Both kinds block walking. Chairs are not colliders.

`validateOfficeMap` checks these rules:

- The tiles are 32 x 32 px, and all six tile layers exist and match the map size.
- `templateId` and `templateVersion` are set.
- Each id is unique within its kind.
- Each `mediaMode` is `proximity` or `room`.
- Zones are disjoint, or nested with a higher priority for the inner zone.
- Each seat lies in the zone that its `zoneId` names, and not on a wall cell.
- Each seat can be reached from the spawn: a cell within 48 px of the seat is reachable from `main` (walls and furniture block the path).
- Each seat with `hasComputer` has a tile in `Computers` or `Above` within 1 tile of the seat.
- Each whiteboard `zoneId` names a zone.
- There is exactly one spawn `main`, and it is on a free cell.

`parseOfficeMap` also checks the structure: orthogonal map, embedded tilesets, required layers with the right type, allowed classes per layer, object shapes and property types.

### Map debug overlay

Press the backquote key (`` ` ``) to show or hide the map debug overlay.
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
| Brown            | Stairs                                                                                        |
| Green crosshair  | Spawn point                                                                                   |

Each zone, seat, whiteboard and sign has a label with its id.

When you move the mouse over the map, the label at the bottom left shows the zone under the mouse and its media mode, for example `meeting-room · room`.
Doors and walls are in no zone, so the label disappears there.

## Status

The project is in phase P0: new toolchain, and the map as data.

Done in P0:

- Vite 8, TypeScript 6, Phaser 4.2.1 and React 19 in npm workspaces (`apps/client`, `packages/shared`). Arcade gravity is 0.
- The map has the Zones, Seats, Interactables, Collision, Spawn, Computers and Above layers.
  The validator passes: 7 zones, 17 seats (all reachable), 11 computer seats with sprites, 3 whiteboards, 15 wall and 20 furniture colliders, 1 spawn. The door tiles are outside every zone.
- `@vo/shared`: map parser, zone lookup and zone tracker, line of sight on the wall grid, reachability and the validator, with tests.
- The office scene builds the map from `@vo/shared`, creates the static collision bodies and has the debug overlay and the zone label.
- GitHub Actions runs typecheck, lint, tests, map validation and build.

Still open in P0:

- Art license: buy the LimeZu licenses, remove the six PNG files from the git history and serve them from private storage (see `CREDITS.md`).
- `apps/server` and `packages/db` do not exist yet.

Next (P1): avatars and movement, camera follow, seats, accounts and the multiplayer server.

## Art and license

The MIT license in `LICENSE` covers the code only. It does not cover the art.

The six tileset images are art by [LimeZu](https://limezu.itch.io/).
If you use or deploy this project, you must have your own LimeZu license.
See `CREDITS.md` for the details.
