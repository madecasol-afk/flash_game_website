/* ==========================================================================
   TDScene.js — The Main Phaser Scene (Game Loop)
   
   WHY a Phaser Scene?
   Phaser organises game logic into "scenes" — think of them like screens
   or levels. Each scene has three lifecycle hooks:
     1. preload() — load assets (images, sounds, data)
     2. create()  — set up the game world (runs once)
     3. update()  — the game loop (runs ~60 times per second)
   
   This scene ties together all our managers (Grid, Pathfinder, Tower,
   Enemy, Wave, HUD) into one coherent game.
   ========================================================================== */

/**
 * TDScene — The tower defense game scene.
 * Extends Phaser.Scene so Phaser manages the lifecycle for us.
 */
class TDScene extends Phaser.Scene {
    constructor() {
        /* WHY 'TDScene' string? Phaser uses this key to reference
           the scene internally. We could name it anything, but
           matching the class name keeps things clear. */
        super('TDScene');
    }

    /* ------------------------------------------------------------------
       preload() — Load assets before the game starts.
       For the MVP we don't load external images — everything is drawn
       with Phaser's built-in graphics API (rectangles, circles, lines).
       This method is here as a placeholder for future sprite sheets.
       ------------------------------------------------------------------ */
    preload() {
        // Future: this.load.image('tileset', 'assets/tileset.png');
        // Future: this.load.audio('place', 'assets/place.mp3');
    }

    /* ------------------------------------------------------------------
       create() — Set up the game world. Runs once after preload().
       ------------------------------------------------------------------ */
    create() {
        const cfg = GAME_CONFIG;

        /* --- Player State --- */
        this.gold  = cfg.player.startGold;
        this.lives = cfg.player.startLives;
        this.gameOver = false;

        /* --- Initialise the Grid ---
           The grid converts the 2D map layout into a data structure
           that all other systems can query. */
        this.gridSystem = new GridSystem(cfg.mapLayout, cfg.grid.tileSize);

        /* --- Draw the Map ---
           Render each tile as a colored rectangle.
           Green = buildable grass, brown = enemy path. */
        this._drawMap();

        /* --- Initialise Pathfinder ---
           Sets up EasyStar with the initial grid state. */
        this.pathfinder = new Pathfinder(this.gridSystem);

        /* --- Initialise Managers --- */
        this.towerManager = new TowerManager(this, this.gridSystem, this.pathfinder);
        this.enemyManager = new EnemyManager(this, this.gridSystem, this.pathfinder);
        this.waveManager  = new WaveManager(this.enemyManager);

        /* --- Initialise HUD ---
           Must happen after TowerManager so the shop buttons can
           reference it. */
        this.hud = new HUD(this.towerManager);
        this.hud.setGold(this.gold);
        this.hud.setLives(this.lives);
        this.hud.setWave(0, this.waveManager.totalWaves);

        /* --- Calculate Initial Path ---
           Enemies need a path before the first wave can spawn. */
        this.enemyManager.refreshPath();

        /* --- Wire Up "Send Wave" Button --- */
        this.hud.onStartWave(() => {
            if (this.gameOver) return;

            const result = this.waveManager.startNextWave(this);
            if (result.started) {
                this.hud.setWave(result.waveNumber, this.waveManager.totalWaves);
            }
        });

        /* --- Handle Canvas Clicks (Tower Placement) ---
           WHY pointerdown instead of click? Phaser's input system uses
           pointerdown for consistency across mouse and touch devices. */
        this.input.on('pointerdown', async (pointer) => {
            if (this.gameOver) return;

            const result = await this.towerManager.placeTower(
                pointer.x, pointer.y, this.gold
            );

            if (result.success) {
                /* Deduct gold and update HUD */
                this.gold -= result.cost;
                this.hud.setGold(this.gold);

                /* Recalculate enemy path after tower placement.
                   WHY? The new tower might block the old route. */
                await this.enemyManager.refreshPath();

                /* Deselect the tower button so the player must
                   explicitly choose again for the next placement. */
                this.hud.deselectAllTowers();
            }
        });

        console.log('🏰 Tower Defense — Game loop started');
    }

    /* ------------------------------------------------------------------
       update(time, delta) — The game loop. Runs every frame (~60 fps).
       
       @param {number} time  — Total elapsed time in ms since game start
       @param {number} delta — Time since last frame in ms
       ------------------------------------------------------------------ */
    update(time, delta) {
        if (this.gameOver) return;

        /* Convert delta from milliseconds to seconds for physics math.
           WHY seconds? It's more intuitive: "speed = 2 tiles per SECOND"
           reads better than "speed = 0.033 tiles per MILLISECOND". */
        const deltaSec = delta / 1000;

        /* --- Update Enemies (move along path, check health) --- */
        const enemyResult = this.enemyManager.update(deltaSec);

        /* --- Award gold for killed enemies --- */
        for (const dead of enemyResult.killed) {
            this.gold += dead.reward;
            this.hud.setGold(this.gold);
        }

        /* --- Deduct lives for enemies that reached the exit --- */
        if (enemyResult.reachedExit > 0) {
            this.lives -= enemyResult.reachedExit;
            this.hud.setLives(this.lives);

            if (this.lives <= 0) {
                this.lives = 0;
                this.hud.setLives(0);
                this._endGame(false); // Defeat
                return;
            }
        }

        /* --- Update Towers (fire at enemies in range) --- */
        const activeEnemies = this.enemyManager.getActiveEnemies();
        this.towerManager.update(time, activeEnemies);

        /* --- Check for Victory --- */
        if (this.waveManager.isAllWavesDone()) {
            this._endGame(true); // Victory!
        }
    }

    /* ------------------------------------------------------------------
       _drawMap() — Render the tile grid to the canvas.
       
       WHY draw it manually instead of using a tilemap image?
       For the MVP, colored rectangles are instant to implement. Each
       tile type gets a distinct color so the player can immediately
       tell buildable areas from enemy paths.
       ------------------------------------------------------------------ */
    _drawMap() {
        const ts = this.gridSystem.tileSize;
        const mapGfx = this.add.graphics();

        for (let r = 0; r < this.gridSystem.rows; r++) {
            for (let c = 0; c < this.gridSystem.cols; c++) {
                const tile = this.gridSystem.grid[r][c];
                const x = c * ts;
                const y = r * ts;

                /* Color-code each tile type */
                switch (tile) {
                    case 0: // Grass (buildable)
                        mapGfx.fillStyle(0x1a3a2a, 1); // dark green
                        break;
                    case 1: // Path
                        mapGfx.fillStyle(0x3d2b1f, 1); // earthy brown
                        break;
                    case 2: // Spawn
                        mapGfx.fillStyle(0x2980b9, 1); // blue
                        break;
                    case 3: // Exit
                        mapGfx.fillStyle(0xc0392b, 1); // red
                        break;
                    default:
                        mapGfx.fillStyle(0x1a3a2a, 1);
                }
                mapGfx.fillRect(x, y, ts, ts);

                /* Subtle grid lines so tiles are visually distinct.
                   WHY very low alpha? We want the grid to be visible
                   but not distracting during gameplay. */
                mapGfx.lineStyle(1, 0xffffff, 0.08);
                mapGfx.strokeRect(x, y, ts, ts);
            }
        }
    }

    /* ------------------------------------------------------------------
       _endGame(victory) — Show the Game Over or Victory overlay.
       
       @param {boolean} victory — true = player won, false = player lost
       ------------------------------------------------------------------ */
    _endGame(victory) {
        this.gameOver = true;

        /* Create an overlay div dynamically.
           WHY HTML overlay instead of canvas? HTML gives us easy text
           styling, blur effects, and a clickable "Play Again" button
           without reimplementing UI logic in canvas. */
        const container = document.getElementById('game-container');

        const overlay = document.createElement('div');
        overlay.className = 'overlay';

        const title = document.createElement('h2');
        title.className = victory
            ? 'overlay-title overlay-title--victory'
            : 'overlay-title overlay-title--defeat';
        title.textContent = victory ? '🎉 Victory!' : '💀 Game Over';

        const btn = document.createElement('button');
        btn.className = 'hud-btn';
        btn.textContent = '🔄 Play Again';
        btn.style.marginTop = '1rem';
        btn.addEventListener('click', () => {
            /* Reload the page to reset all state.
               WHY reload instead of a manual reset? For the MVP this is
               the simplest guaranteed way to clear all Phaser objects,
               timers, and DOM state. We can add a soft-reset later. */
            window.location.reload();
        });

        overlay.appendChild(title);
        overlay.appendChild(btn);
        container.appendChild(overlay);

        /* Trigger the CSS opacity transition */
        requestAnimationFrame(() => {
            overlay.classList.add('visible');
        });
    }
}
