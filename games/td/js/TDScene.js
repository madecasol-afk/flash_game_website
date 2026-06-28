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
        // Load raw AI-generated enemy JPEGs
        // WHY JPEGs? AI-generated images are in JPEG format. We will convert them to transparent sprites
        // programmatically inside create() to avoid needing external image editing software.
        this.load.image('scout_raw', 'assets/images/scout.jpg');
        this.load.image('runner_raw', 'assets/images/runner.jpg');
        this.load.image('tank_raw', 'assets/images/tank.jpg');
        this.load.image('boss_raw', 'assets/images/boss.jpg');

        // Load raw AI-generated tower JPEGs
        this.load.image('tower_basic_raw', 'assets/images/towers/blaster.jpg');
        this.load.image('tower_splash_raw', 'assets/images/towers/cannon.jpg');
        this.load.image('tower_sniper_raw', 'assets/images/towers/sniper.jpg');
        this.load.image('tower_slower_raw', 'assets/images/towers/frost.jpg');
        this.load.image('tower_poisoner_raw', 'assets/images/towers/acid.jpg');
        this.load.image('tower_laser_raw', 'assets/images/towers/laser.jpg');
        this.load.image('tower_booster_raw', 'assets/images/towers/buffer.jpg');
        this.load.image('tower_tesla_raw', 'assets/images/towers/tesla.jpg');
        this.load.image('tower_miner_raw', 'assets/images/towers/miner.jpg');
        this.load.image('tower_doomray_raw', 'assets/images/towers/doomray.jpg');
    }

    /* ------------------------------------------------------------------
       create() — Set up the game world. Runs once after preload().
       ------------------------------------------------------------------ */
    create() {
        const cfg = GAME_CONFIG;

        // Initialize Procedural Audio Synthesizer
        this.soundSystem = new SoundSystem();

        /* --- Player State --- */
        this.gold  = cfg.player.startGold;
        this.lives = cfg.player.startLives;
        this.gameOver = false;

        /* --- Process Textures (Chroma Key Background Removal) ---
           WHY? The JPEGs have an off-white background (R=240, G=240, B=240). By drawing them
           onto an offscreen canvas texture, scanning pixels, and setting alpha to 0 for light pixels,
           we achieve clean transparent sprite sheets natively in browser. */
        const processTexture = (key, rawKey, sliceFrames = true) => {
            const rawImg = this.textures.get(rawKey).getSourceImage();
            const width = 1024;
            const height = 1024;
            const canvasTexture = this.textures.createCanvas(key, width, height);
            canvasTexture.draw(0, 0, rawImg);
            
            const context = canvasTexture.context;
            const imgData = context.getImageData(0, 0, width, height);
            const data = imgData.data;

            // WHY FLOOD FILL? 
            // A naive chroma key (removing all white/grey pixels blindly) creates "broken pixels" (holes) 
            // inside the monster if it has white teeth, grey armor, or shiny highlights.
            // A flood fill starting from the edges guarantees we ONLY remove the background checkerboard
            // and never touch the internal pixels of the monster!
            const visited = new Uint8Array(width * height);
            const queue = new Int32Array(width * height);
            let head = 0;
            let tail = 0;

            const isBg = (idx) => {
                const r = data[idx * 4];
                const g = data[idx * 4 + 1];
                const b = data[idx * 4 + 2];
                // Checkerboards are grey/white. Due to JPEG compression and shadows,
                // edge pixels might be darker (e.g. R=158) or have chromatic noise.
                // We check if the pixel is relatively colorless (a shade of grey).
                // Lower threshold to 30 to catch dark grey checkerboards, but protect pure black outlines.
                return (r > 30 && g > 30 && b > 30) &&
                       (Math.abs(r - g) < 35 && Math.abs(r - b) < 35 && Math.abs(g - b) < 35);
            };

            const pushEdge = (idx) => {
                if (!visited[idx]) {
                    visited[idx] = 1;
                    if (isBg(idx)) {
                        data[idx * 4 + 3] = 0; // Make transparent
                        queue[tail++] = idx;
                    }
                }
            };

            // 1. Seed the edges of the image for the flood fill
            for (let x = 0; x < width; x++) {
                pushEdge(x);
                pushEdge((height - 1) * width + x);
            }
            for (let y = 0; y < height; y++) {
                pushEdge(y * width);
                pushEdge(y * width + (width - 1));
            }

            // 2. BFS Flood Fill the background
            while (head < tail) {
                const idx = queue[head++];
                const x = idx % width;
                const y = Math.floor(idx / width);
                
                // Left
                if (x > 0) {
                    const n = idx - 1;
                    if (!visited[n]) {
                        visited[n] = 1;
                        if (isBg(n)) { data[n * 4 + 3] = 0; queue[tail++] = n; }
                    }
                }
                // Right
                if (x < width - 1) {
                    const n = idx + 1;
                    if (!visited[n]) {
                        visited[n] = 1;
                        if (isBg(n)) { data[n * 4 + 3] = 0; queue[tail++] = n; }
                    }
                }
                // Up
                if (y > 0) {
                    const n = idx - width;
                    if (!visited[n]) {
                        visited[n] = 1;
                        if (isBg(n)) { data[n * 4 + 3] = 0; queue[tail++] = n; }
                    }
                }
                // Down
                if (y < height - 1) {
                    const n = idx + width;
                    if (!visited[n]) {
                        visited[n] = 1;
                        if (isBg(n)) { data[n * 4 + 3] = 0; queue[tail++] = n; }
                    }
                }
                // Diagonals for checkerboard connectivity
                if (x > 0 && y > 0) { // Top-Left
                    const n = idx - width - 1;
                    if (!visited[n]) { visited[n] = 1; if (isBg(n)) { data[n * 4 + 3] = 0; queue[tail++] = n; } }
                }
                if (x < width - 1 && y > 0) { // Top-Right
                    const n = idx - width + 1;
                    if (!visited[n]) { visited[n] = 1; if (isBg(n)) { data[n * 4 + 3] = 0; queue[tail++] = n; } }
                }
                if (x > 0 && y < height - 1) { // Bottom-Left
                    const n = idx + width - 1;
                    if (!visited[n]) { visited[n] = 1; if (isBg(n)) { data[n * 4 + 3] = 0; queue[tail++] = n; } }
                }
                if (x < width - 1 && y < height - 1) { // Bottom-Right
                    const n = idx + width + 1;
                    if (!visited[n]) { visited[n] = 1; if (isBg(n)) { data[n * 4 + 3] = 0; queue[tail++] = n; } }
                }
            }

            // 3. Auto-Detect Layout (2x2 Grid vs 1x4 Strip)
            // After the flood fill, any opaque pixel belongs to a monster!
            let hasTopPixels = false;
            let hasBottomPixels = false;
            let minY = height;
            let maxY = 0;
            let minX = width;
            let maxX = 0;

            for (let i = 0; i < width * height; i++) {
                if (data[i * 4 + 3] !== 0) {
                    const pxX = i % width;
                    const pxY = Math.floor(i / width);
                    if (pxY < minY) minY = pxY;
                    if (pxY > maxY) maxY = pxY;
                    if (pxX < minX) minX = pxX;
                    if (pxX > maxX) maxX = pxX;

                    if (pxY < 250) hasTopPixels = true;
                    if (pxY > 770) hasBottomPixels = true;
                }
            }

            context.putImageData(imgData, 0, 0);
            canvasTexture.refresh();

            // 4. Adaptive Slicing
            if (sliceFrames) {
                const is2x2Grid = hasTopPixels && hasBottomPixels;

                if (is2x2Grid) {
                    // Slice into 2x2 grid of 512x512 frames
                    canvasTexture.add('frame_0', 0, 0, 0, 512, 512);
                    canvasTexture.add('frame_1', 0, 512, 0, 512, 512);
                    canvasTexture.add('frame_2', 0, 0, 512, 512, 512);
                    canvasTexture.add('frame_3', 0, 512, 512, 512, 512);
                } else {
                    // Determine vertical center of the horizontal strip
                    if (minY >= maxY) {
                        minY = 384;
                        maxY = 640;
                    }
                    const midY = Math.floor((minY + maxY) / 2);
                    let sliceY = midY - 128; // Center the 256px frame vertically
                    sliceY = Math.max(0, Math.min(768, sliceY));

                    // Slice into a 1x4 horizontal row of 256x256 frames
                    canvasTexture.add('frame_0', 0, 0, sliceY, 256, 256);
                    canvasTexture.add('frame_1', 0, 256, sliceY, 256, 256);
                    canvasTexture.add('frame_2', 0, 512, sliceY, 256, 256);
                    canvasTexture.add('frame_3', 0, 768, sliceY, 256, 256);
                }
            } else {
                // Static image: Just crop to the tightly bound colored box!
                if (minY > maxY || minX > maxX) {
                    minX = 0; minY = 0; maxX = width - 1; maxY = height - 1;
                }
                const bW = maxX - minX + 1;
                const bH = maxY - minY + 1;
                canvasTexture.add('cropped', 0, minX, minY, bW, bH);
            }
        };

        // Process enemy walk cycles (sliceFrames = true)
        processTexture('basic_clean', 'scout_raw', true);
        processTexture('fast_clean', 'runner_raw', true);
        processTexture('armored_clean', 'tank_raw', true);
        processTexture('boss_clean', 'boss_raw', true);

        // Process tower graphics (sliceFrames = false)
        const towerKeys = ['basic', 'splash', 'sniper', 'slower', 'poisoner', 'laser', 'booster', 'tesla', 'miner', 'doomray'];
        for (const tk of towerKeys) {
            processTexture(`tower_${tk}_clean`, `tower_${tk}_raw`, false);
        }

        // Create walking animations for all 4 monster types
        const createWalkAnim = (key, textureKey) => {
            this.anims.create({
                key: key,
                frames: [
                    { key: textureKey, frame: 'frame_0' },
                    { key: textureKey, frame: 'frame_1' },
                    { key: textureKey, frame: 'frame_2' },
                    { key: textureKey, frame: 'frame_3' }
                ],
                frameRate: 6,
                repeat: -1
            });
        };

        createWalkAnim('basic_walk', 'basic_clean');
        createWalkAnim('fast_walk', 'fast_clean');
        createWalkAnim('armored_walk', 'armored_clean');
        createWalkAnim('boss_walk', 'boss_clean');

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
        this.hud = new HUD(this, this.towerManager);
        this.hud.setGold(this.gold);
        this.hud.setLives(this.lives);
        this.hud.setWave(0, this.waveManager.totalWaves);
        
        // Track the currently selected/inspected tower for upgrade overlays
        this.inspectedTower = null;

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
                let reward = miner.goldGeneration || def.goldGeneration;

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

        /* --- Tower Upgrade Event Handler ---
           WHY? When a player clicks the "Upgrade" button in the HUD inspector, it emits this event.
           We deduct the cost, increment the level, apply updated stats (damage, range, etc.),
           trigger a redraw of the tower's level dots, recalculate buffs, and update the HUD inspector display. */
        this.events.on('upgrade-tower', (tower, upgradeType, cost) => {
            if (this.gold >= cost) {
                this.gold -= cost;
                this.hud.setGold(this.gold);

                const def = GAME_CONFIG.towers[tower.type];

                if (upgradeType === 'damage') {
                    tower.damageLevel++;
                    tower.damageSpent += cost;
                    
                    // Standard damage
                    if (def.damage > 0) {
                        tower.baseDamage = def.damage * Math.pow(1.10, tower.damageLevel);
                        tower.damage = tower.baseDamage;
                    }
                    
                    // Special stats
                    if (def.goldGeneration) tower.goldGeneration = def.goldGeneration * Math.pow(1.10, tower.damageLevel);
                    if (def.buffMultiplier) tower.buffMultiplier = 1.0 + ((def.buffMultiplier - 1.0) * Math.pow(1.10, tower.damageLevel));
                    if (def.slowMultiplier) tower.slowMultiplier = def.slowMultiplier * Math.pow(0.95, tower.damageLevel); // becomes stronger/closer to 0
                    if (def.poisonDamage) tower.poisonDamage = def.poisonDamage * Math.pow(1.10, tower.damageLevel);
                    if (def.chainTargets) tower.chainTargets = def.chainTargets + Math.floor(tower.damageLevel / 5);

                } else if (upgradeType === 'speed') {
                    tower.speedLevel++;
                    tower.speedSpent += cost;
                    tower.baseFireRate = def.fireRate + (0.2 * tower.speedLevel);
                    if (tower.baseFireRate > 15) tower.baseFireRate = 15;
                    tower.fireRate = tower.baseFireRate;

                } else if (upgradeType === 'range') {
                    tower.rangeLevel++;
                    tower.rangeSpent += cost;
                    tower.baseRange = def.range + (0.2 * tower.rangeLevel);
                    tower.range = tower.baseRange;
                }

                // Redraw graphics to show new gold stars/dots
                this.towerManager.redrawTower(tower);

                // Recalculate booster buffs in case we upgraded a Buffer tower or a buffed tower
                this.towerManager.recalculateBuffs();

                // Refresh details pane and range indicator circle
                this.hud.showInspectedTowerDetails(tower);
                const pos = this.gridSystem.tileToPixel(tower.col, tower.row);
                this._updateRangeIndicator({ x: pos.x, y: pos.y });

                // Play a brief high-pitched upgrade sound effect / flash!
                this.cameras.main.flash(150, 26, 188, 156, false); // Cyan flash
            }
        });

        /* --- Mass Upgrade Event Handler ---
           Upgrades a specific stat for ALL towers of a specific class. */
        this.events.on('mass-upgrade', (towerClass, upgradeType) => {
            const def = GAME_CONFIG.towers[towerClass];
            if (!def) return;

            let totalCost = 0;
            let count = 0;
            const towersToUpgrade = [];

            // 1. Calculate total cost to verify affordability
            for (const tower of this.towerManager.towers) {
                if (tower.type === towerClass) {
                    let cost = 0;
                    if (upgradeType === 'damage') {
                        cost = Math.round(def.cost * Math.pow(1.15, tower.damageLevel));
                    } else if (upgradeType === 'speed') {
                        if (tower.fireRate >= 15) continue; // Skip if maxed out
                        cost = Math.round((def.cost * 1.5) * Math.pow(1.15, tower.speedLevel));
                    } else if (upgradeType === 'range') {
                        cost = Math.round((def.cost * 0.8) * Math.pow(1.15, tower.rangeLevel));
                    }
                    totalCost += cost;
                    count++;
                    towersToUpgrade.push({ tower, cost });
                }
            }

            // 2. Perform the upgrade if affordable
            if (count > 0 && this.gold >= totalCost) {
                this.gold -= totalCost;
                this.hud.setGold(this.gold);

                for (const { tower, cost } of towersToUpgrade) {
                    if (upgradeType === 'damage') {
                        tower.damageLevel++;
                        tower.damageSpent += cost;
                        if (def.damage > 0) {
                            tower.baseDamage = def.damage * Math.pow(1.10, tower.damageLevel);
                            tower.damage = tower.baseDamage;
                        }
                        if (def.goldGeneration) tower.goldGeneration = def.goldGeneration * Math.pow(1.10, tower.damageLevel);
                        if (def.buffMultiplier) tower.buffMultiplier = 1.0 + ((def.buffMultiplier - 1.0) * Math.pow(1.10, tower.damageLevel));
                        if (def.slowMultiplier) tower.slowMultiplier = def.slowMultiplier * Math.pow(0.95, tower.damageLevel);
                        if (def.poisonDamage) tower.poisonDamage = def.poisonDamage * Math.pow(1.10, tower.damageLevel);
                        if (def.chainTargets) tower.chainTargets = def.chainTargets + Math.floor(tower.damageLevel / 5);
                    } else if (upgradeType === 'speed') {
                        tower.speedLevel++;
                        tower.speedSpent += cost;
                        tower.baseFireRate = def.fireRate + (0.2 * tower.speedLevel);
                        if (tower.baseFireRate > 15) tower.baseFireRate = 15;
                        tower.fireRate = tower.baseFireRate;
                    } else if (upgradeType === 'range') {
                        tower.rangeLevel++;
                        tower.rangeSpent += cost;
                        tower.baseRange = def.range + (0.2 * tower.rangeLevel);
                        tower.range = tower.baseRange;
                    }

                    this.towerManager.redrawTower(tower);
                }

                this.towerManager.recalculateBuffs();

                // Refresh inspector if one of these towers is currently selected
                if (this.inspectedTower && this.inspectedTower.type === towerClass) {
                    this.hud.showInspectedTowerDetails(this.inspectedTower);
                }

                this.cameras.main.flash(200, 46, 204, 113, false); // Green flash for mass upgrade
            }
        });

        /* --- Tower Sell Event Handler ---
           WHY? When a player clicks the "Sell" button in the HUD inspector, it emits this event.
           We reuse the towerManager's sell function, award the refund gold, recalculate paths and buffs,
           and clear the inspector overlay. */
        this.events.on('sell-tower', (tower) => {
            const pos = this.gridSystem.tileToPixel(tower.col, tower.row);
            const sellResult = this.towerManager.sellTower(pos.x, pos.y);
            
            if (sellResult.success) {
                this.gold += sellResult.refund;
                this.hud.setGold(this.gold);

                // Recalculate paths now that space is cleared
                this.enemyManager.refreshPath();

                // Clear inspector selection and range indicator circle
                this.inspectedTower = null;
                this.hud.showInspectorDetails(null);
                this.rangeIndicator.clear();
            }
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
            this.inspectedTower = null;
            this.hud.showInspectorDetails(null);
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

            // --- CASE 3: Normal Placement / Selection Flow ---
            if (this.towerManager.selectedType) {
                // We have a tower type selected from the shop — try to build it!
                const result = this.towerManager.placeTower(
                    pointer.x, pointer.y, this.gold
                );

                if (result.success) {
                    /* Deduct gold and update HUD */
                    this.gold -= result.cost;
                    this.hud.setGold(this.gold);

                    /* Recalculate enemy path after tower placement. */
                    this.enemyManager.refreshPath();

                    /* Deselect the tower button so the player must
                       explicitly choose again for the next placement. */
                    this.hud.deselectAllTowers();
                    this.rangeIndicator.clear();
                }
            } else {
                // No shop item is selected — check if clicking an existing tower to inspect/upgrade it!
                const { col, row } = this.gridSystem.pixelToTile(pointer.x, pointer.y);
                const clickedTower = this.towerManager.towers.find(t => t.col === col && t.row === row);

                if (clickedTower) {
                    // Select this tower for inspection
                    this.inspectedTower = clickedTower;
                    this.hud.showInspectedTowerDetails(clickedTower);
                    
                    // Force-redraw the range overlay circle on this tower
                    this._updateRangeIndicator(pointer);
                } else {
                    // Clicked empty grass — clear current inspection
                    this.inspectedTower = null;
                    this.hud.showInspectorDetails(null);
                    this.rangeIndicator.clear();
                }
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
        // CASE 3: Hovering over or inspecting an existing placed tower.
        else {
            const hoveredTower = this.towerManager.towers.find(t => t.col === col && t.row === row);
            
            // Draw range for hovered tower, or fallback to the currently inspected tower
            const activeTower = hoveredTower || this.inspectedTower;
            
            if (activeTower) {
                rangeTiles = activeTower.range;
                
                // Draw the circle exactly centered on the active tower's coordinates.
                const towerPos = this.gridSystem.tileToPixel(activeTower.col, activeTower.row);
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
