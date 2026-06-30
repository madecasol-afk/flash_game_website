/* ==========================================================================
   EnemyManager.js — Enemy Spawning, Movement, and Lifecycle
   
   WHY a separate EnemyManager?
   Enemies are the most CPU-intensive part of a TD game — dozens of
   objects moving every frame, checking health, following paths. Isolating
   this logic makes profiling and optimising easier.
   ========================================================================== */

/**
 * EnemyManager — Creates, moves, and tracks enemy instances.
 * 
 * Each enemy is a plain object:
 * {
 *   active,                — is the enemy alive and on-screen?
 *   type,                  — 'basic', 'fast', 'armored', 'boss'
 *   health, maxHealth,     — current and max HP
 *   speed,                 — tiles per second
 *   reward,                — gold given to player on death
 *   x, y,                  — current pixel position
 *   pathIndex,             — which waypoint in the path we're heading toward
 *   path,                  — array of { x: col, y: row } waypoints from A*
 *   graphics,              — Phaser graphics object (the enemy "sprite")
 *   hpBar,                 — Phaser graphics for the health bar
 *   takeDamage(amount),    — method to apply damage
 * }
 */
class EnemyManager {
    /**
     * @param {Phaser.Scene} scene      - Active Phaser scene
     * @param {GridSystem}   gridSystem - Grid for coordinate conversions
     * @param {Pathfinder}   pathfinder - Pathfinder for route calculation
     */
    constructor(scene, gridSystem, pathfinder) {
        this.scene = scene;
        this.gridSystem = gridSystem;
        this.pathfinder = pathfinder;

        /* WHY an array instead of a Phaser Group?
           Plain arrays are simpler to iterate and filter. We manage
           object pooling manually (reusing dead enemy slots) to avoid
           garbage collection stutters — a key best practice from our
           HTML5 game loop research. */
        this.enemies = [];

        /* Cache the current path so we don't recalculate for every enemy.
           When towers are placed, TDScene calls refreshPath() to update. */
        this.currentPath = null;
    }

    /**
     * refreshPath — Recalculate the enemy path from spawn to exit.
     * 
     * Called once at game start and every time a tower is placed/sold.
     *
     * @returns {boolean} true if a valid path was found
     */
    refreshPath() {
        const spawn = this.gridSystem.spawnTile;
        const exit  = this.gridSystem.exitTile;
        this.currentPath = this.pathfinder.findPath(
            spawn.col, spawn.row, exit.col, exit.row
        );
        return this.currentPath !== null;
    }

    /**
     * spawnEnemy — Create a new enemy of the given type.
     * 
     * @param {string} type - Key into GAME_CONFIG.enemies (e.g., 'basic')
     */
    spawnEnemy(type, waveNumber = 1) {
        const def = GAME_CONFIG.enemies[type];
        if (!def) {
            console.warn(`EnemyManager: unknown enemy type "${type}"`);
            return;
        }

        if (!this.currentPath || this.currentPath.length === 0) {
            console.warn('EnemyManager: no valid path — cannot spawn');
            return;
        }

        // Compounding health scaling: +12% health per wave
        // WHY? As waves progress, the player builds more towers and purchases upgrades.
        // Scaling enemy HP exponentially ensures the game remains challenging.
        const hpMultiplier = Math.pow(1.1, waveNumber - 1);
        const scaledHealth = Math.round(def.health * hpMultiplier);
        
        // Scale gold rewards so players can afford infinite upgrades in the late game
        const rewardMultiplier = Math.pow(1.05, waveNumber - 1);
        const scaledReward = Math.round(def.reward * rewardMultiplier);

        /* Start at the spawn tile's pixel centre */
        const startTile = this.currentPath[0];
        const startPos = this.gridSystem.tileToPixel(startTile.x, startTile.y);

        const tileSize = this.gridSystem.tileSize;

        // Create the animated sprite for the enemy monster.
        // WHY? Replaces simple placeholder circles with beautiful walking characters!
        // We load the transparent canvas texture we processed dynamically in TDScene.js.
        const sprite = this.scene.add.sprite(startPos.x, startPos.y, `${type}_clean`, 'frame_0');
        
        // Scale the frame down to fit our grid tile (40px).
        // Bosses are scaled to be larger and more intimidating (1.4 times tile size).
        // WHY divide by sprite.frame.width? Our auto-layout processor slices some sheets as 512x512
        // and others as 256x256. Dividing by the frame's actual width ensures perfect scaling for all layout types.
        const targetSize = type === 'boss' ? tileSize * 1.4 : tileSize * 0.8;
        sprite.setScale(targetSize / sprite.frame.width);

        // Start playing the loop walking animation.
        sprite.play(`${type}_walk`);

        /* Health bar: thin bar above the enemy that shrinks as it takes damage.
           WHY a separate graphics object? So we can update it independently
           without redrawing the enemy body every frame. */
        const hpBar = this.scene.add.graphics();

        /* Create the enemy data object */
        const enemy = {
            active: true,
            type,
            health: scaledHealth,
            maxHealth: scaledHealth,
            speed: def.speed,
            reward: scaledReward,
            x: startPos.x,
            y: startPos.y,
            pathIndex: 1, // Start heading toward the SECOND waypoint (index 1)
            path: [...this.currentPath], // Copy so each enemy has its own path ref
            sprite: sprite, // Ref to the Phaser Sprite object
            hpBar,
            
            // Effect Stats
            slowMultiplier: 1.0,      // 1.0 = normal speed, 0.5 = 50% slow
            slowTimer: 0,             // seconds remaining for the slow effect
            poisonDamagePerSec: 0,    // poison/acid damage taken per second
            poisonTimer: 0,           // seconds remaining for the poison/acid effect

            /**
             * takeDamage — Reduce enemy health. If it drops to 0, mark as dead.
             * 
             * WHY a method on the object instead of a standalone function?
             * This keeps the damage logic co-located with the enemy data,
             * making it easy to add effects later (e.g., slow on hit).
             *
             * @param {number} amount - Damage to apply
             */
            takeDamage(amount) {
                this.health -= amount;
                if (this.health <= 0) {
                    this.health = 0;
                    this.active = false;
                    this.sprite.destroy();
                    this.hpBar.destroy();
                }
            },

            /**
             * takeSlow — Applies a speed-reducing frost effect.
             * @param {number} multiplier - Speed reduction multiplier (e.g. 0.5 = half speed)
             * @param {number} duration - Duration of the slow effect in seconds
             */
            takeSlow(multiplier, duration) {
                // Apply the slow. Keep the strongest slow (lowest multiplier) and longest duration.
                this.slowMultiplier = Math.min(this.slowMultiplier, multiplier);
                this.slowTimer = Math.max(this.slowTimer, duration);
            },

            /**
             * takePoison — Applies a damage-over-time poison/acid effect.
             * @param {number} dmgPerSec - Tick damage applied per second
             * @param {number} duration - Duration of the poison effect in seconds
             */
            takePoison(dmgPerSec, duration) {
                // Apply the poison. Keep the highest tick damage and longest duration.
                this.poisonDamagePerSec = Math.max(this.poisonDamagePerSec, dmgPerSec);
                this.poisonTimer = Math.max(this.poisonTimer, duration);
            }
        };

        this.enemies.push(enemy);
    }

    /**
     * update — Move all active enemies along their paths. Called every frame.
     * 
     * @param {number} delta - Time since last frame in SECONDS
     * @returns {{ reachedExit: number, killed: object[] }}
     *   - reachedExit: how many enemies reached the exit this frame
     *   - killed: enemies that died this frame (for gold rewards)
     */
    update(delta) {
        let reachedExit = 0;
        const killed = [];
        const tileSize = this.gridSystem.tileSize;

        for (const enemy of this.enemies) {
            if (!enemy.active) {
                /* Check if enemy just died (health was set to 0 by takeDamage) */
                if (enemy.health <= 0 && enemy.reward > 0) {
                    /* WHY push a new object instead of the enemy itself?
                       We set enemy.reward = 0 right after to prevent
                       double-counting. But since arrays hold REFERENCES
                       (not copies), TDScene would read the already-zeroed
                       value. By pushing { reward: enemy.reward }, we
                       capture a snapshot of the reward BEFORE zeroing. */
                    killed.push({ reward: enemy.reward });
                    enemy.reward = 0;
                }
                continue;
            }

            // --- Tick Effects (Poison / Acid & Slow timers) ---
            // Apply Damage Over Time (DOT) for poison/acid.
            // WHY? Poison damage is applied continuously on every frame based on the time elapsed (delta).
            if (enemy.poisonTimer > 0) {
                const tickDamage = enemy.poisonDamagePerSec * delta;
                enemy.takeDamage(tickDamage);
                enemy.poisonTimer -= delta;
            }

            // Check if the enemy is still alive after poison damage before proceeding to move it.
            if (!enemy.active) {
                continue;
            }

            // Update slow timers and speed modifiers.
            if (enemy.slowTimer > 0) {
                enemy.slowTimer -= delta;
                if (enemy.slowTimer <= 0) {
                    enemy.slowMultiplier = 1.0; // Reset to full speed
                }
            }

            /* --- Movement ---
               Move toward the next waypoint in the path. When we reach it,
               advance pathIndex to the following waypoint. */
            if (enemy.pathIndex >= enemy.path.length) {
                /* Enemy reached the exit — remove it and cost the player a life */
                enemy.active = false;
                enemy.sprite.destroy();
                enemy.hpBar.destroy();
                reachedExit++;
                continue;
            }

            const targetWaypoint = enemy.path[enemy.pathIndex];
            const targetPos = this.gridSystem.tileToPixel(targetWaypoint.x, targetWaypoint.y);

            /* Calculate direction vector from enemy to target waypoint */
            const dx = targetPos.x - enemy.x;
            const dy = targetPos.y - enemy.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            /* How far can the enemy move this frame? 
               WHY multiply by slowMultiplier? If the enemy is frozen/slowed, their movement speed reduces accordingly. */
            const currentSpeed = enemy.speed * enemy.slowMultiplier;
            const moveDistance = currentSpeed * tileSize * delta;

            if (dist <= moveDistance) {
                /* Close enough — snap to waypoint and advance to the next one */
                enemy.x = targetPos.x;
                enemy.y = targetPos.y;
                enemy.pathIndex++;
            } else {
                /* Move toward the waypoint by moveDistance pixels.
                   WHY normalise? (dx/dist, dy/dist) gives us a unit direction
                   vector. Multiplying by moveDistance ensures consistent speed
                   regardless of the distance to the waypoint. */
                enemy.x += (dx / dist) * moveDistance;
                enemy.y += (dy / dist) * moveDistance;
            }

            /* Update the visual position and rotation of the enemy sprite
               WHY rotation? Adjusting rotation based on angle of movement makes the sprite face the correct direction. */
            enemy.sprite.setPosition(enemy.x, enemy.y);
            enemy.sprite.rotation = Math.atan2(dy, dx);

            /* --- Health Bar ---
               Draw a thin bar above the enemy. Green portion = remaining HP. */
            enemy.hpBar.clear();
            const barWidth = tileSize * 0.6;
            const barHeight = 4;
            const barX = enemy.x - barWidth / 2;
            const barY = enemy.y - tileSize * 0.4;
            const hpFraction = enemy.health / enemy.maxHealth;

            /* Background (dark red) */
            enemy.hpBar.fillStyle(0x333333, 0.8);
            enemy.hpBar.fillRect(barX, barY, barWidth, barHeight);

            /* Foreground (green → yellow → red based on HP %)
               WHY color interpolation? It gives instant visual feedback
               about how close the enemy is to dying, just like Bloons. */
            const barColor = hpFraction > 0.5 ? 0x2ecc71 : (hpFraction > 0.25 ? 0xf39c12 : 0xe74c3c);
            enemy.hpBar.fillStyle(barColor, 1);
            enemy.hpBar.fillRect(barX, barY, barWidth * hpFraction, barHeight);
        }

        return { reachedExit, killed };
    }

    /**
     * getActiveEnemies — Returns only the enemies that are alive and on-screen.
     * 
     * WHY filter every call? The towers need this list to pick targets.
     * Filtering is cheap for < 100 enemies, which is our scale.
     *
     * @returns {object[]}
     */
    getActiveEnemies() {
        return this.enemies.filter(e => e.active);
    }

    /**
     * clearAll — Remove all enemies (used on game reset).
     */
    clearAll() {
        for (const enemy of this.enemies) {
            if (enemy.sprite && enemy.sprite.active) enemy.sprite.destroy();
            if (enemy.hpBar && enemy.hpBar.active) enemy.hpBar.destroy();
        }
        this.enemies = [];
    }
}
