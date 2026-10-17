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
│       ├── public/assets/map/  Tiled map (map.tmx, map.json) and tileset images
│       ├── src/
│       │   ├── main.tsx        React entry point
│       │   ├── App.tsx         Full-screen layout. The HUD goes here later.
│       │   └── game/
│       │       ├── EventBus.ts     Events between React and Phaser
│       │       ├── PhaserGame.tsx  Creates and destroys the Phaser game
│       │       ├── config.ts       Phaser game settings
│       │       └── scenes/
│       │           └── OfficeScene.ts  Loads and shows the office map
│       └── vite.config.ts
├── packages/
│   └── shared/                 Code for the client and the server (@vo/shared)
├── .github/workflows/ci.yml    Continuous integration
├── CREDITS.md                  Art credits and license notes
├── eslint.config.js
├── tsconfig.base.json          TypeScript settings for all workspaces
└── vitest.config.ts
```

The repository uses npm workspaces. Each folder in `apps/` and `packages/` is a workspace.

## How the map works

The office map is a [Tiled](https://www.mapeditor.org/) map.
Edit `apps/client/public/assets/map/map.tmx` in Tiled 1.11.
Then export it as JSON to `map.json` in the same folder.

The map has 40 x 30 tiles. Each tile is 32 x 32 pixels.
It uses six embedded tilesets.
The game loads each tileset image with a texture key that is equal to the tileset name in Tiled.
If you add a tileset, you must also add its name to `OfficeScene.ts`.

The camera shows the full map in the center of the window.
It uses the largest whole-number zoom that fits.
If the map does not fit at zoom 1, it uses a smaller zoom.

The layer contract (the names, types and properties of each layer) will be added here.

## Art and license

The MIT license in `LICENSE` covers the code only. It does not cover the art.

The six tileset images are art by [LimeZu](https://limezu.itch.io/).
If you use or deploy this project, you must have your own LimeZu license.
See `CREDITS.md` for the details.
