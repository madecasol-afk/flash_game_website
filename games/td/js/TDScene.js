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
        
        // Check and apply initial locks/unlocks for Wave 0
        this.hud.updateUnlockStates(0);

        /* --- Calculate Initial Path ---
           Enemies need a path before the first wave can spawn. */
        this.enemyManager.refreshPath();

        /* --- Wire Up "Send Wave" Button --- */
        this.hud.onStartWave(() => {
            if (this.gameOver) return;

            const result = this.waveManager.startNextWave(this);
            if (result.started) {
                this.hud.setWave(result.waveNumber, this.waveManager.totalWaves);
                
                // Update unlock states based on the wave that just started
                // WHY? High-tier towers unlock dynamically after the player survives to specific waves.
                this.hud.updateUnlockStates(result.waveNumber);
            }
        });

        /* --- Wave Complete Event Handler ---
           WHY? When a wave ends, Gold Miner towers generate gold. We listen for this event,
           scan the map for miners, add the gold, and play a visual text popup animation. */
        this.events.on('wave-complete', () => {
            // Find all active Gold Miner towers placed on the map
            // SYNTAX BREAKDOWN:
            // - Array.prototype.filter() returns a new array containing only elements that match the condition.
            const miners = this.towerManager.towers.filter(t => t.type === 'miner');

            miners.forEach(miner => {
                const def = GAME_CONFIG.towers.miner;
                let reward = def.goldGeneration;

                // Adjust reward based on upgrade level if the miner has been upgraded
                for (let i = 0; i < miner.level; i++) {
                    reward = def.upgrades[i].goldGeneration ?? reward;
                }

                // Add gold and update display
                this.gold += reward;
                this.hud.setGold(this.gold);

                // Get pixel coordinates of the tower
                const pos = this.gridSystem.tileToPixel(miner.col, miner.row);

                // Create floating green text above the miner tower (+Gold!)
                // WHY? Visual feedback makes game accomplishments feel rewarding.
                const popText = this.add.text(pos.x, pos.y - 20, `+$${reward}`, {
                    fontFamily: 'Outfit',
                    fontSize: '14px',
                    fontStyle: 'bold',
                    color: '#1abc9c'
                }).setOrigin(0.5);

                // Animate the text floating upwards and fading away
                this.tweens.add({
                    targets: popText,
                    y: pos.y - 45,       // Move 25 pixels higher
                    alpha: 0,            // Fade to completely transparent
                    duration: 1200,      // Animation runs for 1.2 seconds (1200ms)
                    onComplete: () => popText.destroy() // Destroy object from memory when done
                });
            });
        });

        /* --- Track Mouse Movement for Range Visualization ---
           WHY? We create a dedicated graphics object to draw the semi-transparent circle.
           Having a single object that clears and redraws every frame is highly performant. */
        this.rangeIndicator = this.add.graphics();

        // Listen for the cursor moving across the canvas.
        // WHY? We want to dynamically draw the range circle under the cursor when placing/moving,
        // or around towers when simply hovering over them.
        this.input.on('pointermove', (pointer) => {
            this._updateRangeIndicator(pointer);
        });

        // Clear the range drawing when the cursor leaves the game area.
        this.input.on('pointerout', () => {
            this.rangeIndicator.clear();
        });

        /* --- Listen for Escape Key (Cancel Selection / Cancel Move) ---
           WHY? Standard game design. If a player changes their mind, hitting Escape
           is the most intuitive way to abort their current action. */
        this.input.keyboard.on('keydown-ESC', () => {
            // If we are currently moving a tower, return it to its starting location.
            if (this.towerManager.movingTower) {
                this.towerManager.cancelMove();
                this.enemyManager.refreshPath(); // Recalculate just in case
            }
            this.hud.deselectAllTowers();
            this.rangeIndicator.clear();
        });

        /* --- Handle Canvas Clicks (Tower Placement, Selling, & Moving) ---
           WHY pointerdown instead of click? Phaser's input system uses
           pointerdown for consistency across mouse and touch devices. */
        this.input.on('pointerdown', (pointer) => {
            // If the game has ended, stop processing inputs.
            if (this.gameOver) return;

            // --- CASE 1: Sell Mode ---
            if (this.towerManager.selectedType === 'sell') {
                const sellResult = this.towerManager.sellTower(pointer.x, pointer.y);

                if (sellResult.success) {
                    this.gold += sellResult.refund;
                    this.hud.setGold(this.gold);
                    this.enemyManager.refreshPath();
                    this.hud.deselectAllTowers();
                    this.rangeIndicator.clear(); // Clear range circle
                }
                return;
            }

            // --- CASE 2: Move Mode ---
            if (this.towerManager.selectedType === 'move') {
                // If a wave is currently running, block moving!
                // WHY? The user requested "tower can be freely moved after a wave."
                // Moving towers while enemies are running makes it easy to cheat or break pathing calculations.
                if (this.waveManager.waveActive) {
                    console.log("⚠️ Cannot move towers while a wave is active!");
                    return;
                }

                // SUB-CASE 2A: We don't have a tower picked up yet -> try to pick one up.
                if (!this.towerManager.movingTower) {
                    const pickedUp = this.towerManager.pickUpTower(pointer.x, pointer.y);
                    if (pickedUp) {
                        // Immediately refresh range drawing around the cursor
                        this._updateRangeIndicator(pointer);
                    }
                }
                // SUB-CASE 2B: We ALREADY have a tower picked up -> try to drop it at the click position.
                else {
                    const placed = this.towerManager.dropTower(pointer.x, pointer.y);
                    if (placed) {
                        // Recalculate path for enemies since the tower moved
                        this.enemyManager.refreshPath();

                        // Deselect Move Mode and clean up overlays
                        this.hud.deselectAllTowers();
                        this.rangeIndicator.clear();
                    } else {
                        // If drop failed (invalid tile or blocks path), cancel and return to origin
                        this.towerManager.cancelMove();
                        this.enemyManager.refreshPath(); // restore path safety
                        this.hud.deselectAllTowers();
                        this.rangeIndicator.clear();
                    }
                }
                return;
            }

            // --- CASE 3: Normal Placement Flow ---
            const result = this.towerManager.placeTower(
                pointer.x, pointer.y, this.gold
            );

            if (result.success) {
                /* Deduct gold and update HUD */
                this.gold -= result.cost;
                this.hud.setGold(this.gold);

                /* Recalculate enemy path after tower placement.
                   WHY? The new tower might block the old route. */
                this.enemyManager.refreshPath();

                /* Deselect the tower button so the player must
                   explicitly choose again for the next placement. */
                this.hud.deselectAllTowers();
                this.rangeIndicator.clear();
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

    /**
     * _updateRangeIndicator — Draws a circular, semi-transparent range overlay.
     * 
     * Purpose:
     * This method decides what range circle to draw depending on the active game state:
     * 1. If dragging a tower in "Move Mode", it draws the range around the snapped cursor.
     * 2. If placing a new tower, it draws the range around the snapped cursor.
     * 3. If hovering over an existing placed tower, it highlights that tower's range.
     * 4. Otherwise, it clears the circle.
     *
     * @param {Phaser.Input.Pointer} pointer - The current mouse/touch pointer
     * @private
     */
    _updateRangeIndicator(pointer) {
        // Clear any previous range circle drawings.
        this.rangeIndicator.clear();

        // If the game is over, do not show any range overlays.
        if (this.gameOver) return;

        const tileSize = this.gridSystem.tileSize;

        // Convert the raw mouse pixel coordinates intoSnapped grid tile coordinates.
        const { col, row } = this.gridSystem.pixelToTile(pointer.x, pointer.y);

        // Convert grid tile coordinate back to pixel center coordinate.
        const snapPos = this.gridSystem.tileToPixel(col, row);

        let rangeTiles = 0;
        let drawX = snapPos.x;
        let drawY = snapPos.y;

        // CASE 1: The player is in Move Mode and dragging a picked up tower.
        if (this.towerManager.selectedType === 'move' && this.towerManager.movingTower) {
            rangeTiles = this.towerManager.movingTower.range;
            
            // Move the ghost tower graphics along with the snapped cursor!
            // WHY? It makes the dragging action look snapped and responsive.
            this.towerManager.movingTower.graphics.setPosition(snapPos.x, snapPos.y);
        }
        // CASE 2: The player has selected a tower from the shop to place.
        else if (this.towerManager.selectedType && this.towerManager.selectedType !== 'sell' && this.towerManager.selectedType !== 'move') {
            const towerDef = GAME_CONFIG.towers[this.towerManager.selectedType];
            rangeTiles = towerDef.range;
        }
        // CASE 3: Hovering over an existing placed tower.
        else {
            // Search the towers list for a tower placed at the currently hovered grid tile.
            // SYNTAX BREAKDOWN:
            // - Array.prototype.find() searches the array and returns the first element that satisfies the condition.
            const hoveredTower = this.towerManager.towers.find(t => t.col === col && t.row === row);
            
            if (hoveredTower) {
                rangeTiles = hoveredTower.range;
                
                // Draw the circle exactly centered on the placed tower's coordinates.
                const towerPos = this.gridSystem.tileToPixel(hoveredTower.col, hoveredTower.row);
                drawX = towerPos.x;
                drawY = towerPos.y;
            }
        }

        // If we identified a valid range to draw:
        if (rangeTiles > 0) {
            const rangePixels = rangeTiles * tileSize;

            // Set styling for the circle line (width: 2px, color: cyan (0x00ffff), alpha: 0.5)
            this.rangeIndicator.lineStyle(2, 0x00ffff, 0.5);

            // Set styling for the circle fill (color: cyan (0x00ffff), alpha: 0.15)
            // WHY 0.15 alpha? This matches the user's request for a "partially transparent" circle,
            // allowing them to see the grid and path through the overlay.
            this.rangeIndicator.fillStyle(0x00ffff, 0.15);

            // Draw the circle shapes.
            this.rangeIndicator.fillCircle(drawX, drawY, rangePixels);
            this.rangeIndicator.strokeCircle(drawX, drawY, rangePixels);
        }
    }
}
