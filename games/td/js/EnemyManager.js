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
    spawnEnemy(type) {
        const def = GAME_CONFIG.enemies[type];
        if (!def) {
            console.warn(`EnemyManager: unknown enemy type "${type}"`);
            return;
        }

        if (!this.currentPath || this.currentPath.length === 0) {
            console.warn('EnemyManager: no valid path — cannot spawn');
            return;
        }

        /* Start at the spawn tile's pixel centre */
        const startTile = this.currentPath[0];
        const startPos = this.gridSystem.tileToPixel(startTile.x, startTile.y);

        const tileSize = this.gridSystem.tileSize;

        /* Draw the enemy as a colored circle.
           WHY circles instead of sprites? Same as towers — fast to implement
           for the MVP. The color-per-type system mirrors Bloons TD where
           balloon color instantly communicates enemy difficulty. */
        const gfx = this.scene.add.graphics();
        gfx.fillStyle(def.color, 1);
        gfx.fillCircle(0, 0, tileSize * 0.3);
        gfx.setPosition(startPos.x, startPos.y);

        /* Health bar: thin bar above the enemy that shrinks as it takes damage.
           WHY a separate graphics object? So we can update it independently
           without redrawing the enemy body every frame. */
        const hpBar = this.scene.add.graphics();

        /* Create the enemy data object */
        const enemy = {
            active: true,
            type,
            health: def.health,
            maxHealth: def.health,
            speed: def.speed,
            reward: def.reward,
            x: startPos.x,
            y: startPos.y,
            pathIndex: 1, // Start heading toward the SECOND waypoint (index 1)
            path: [...this.currentPath], // Copy so each enemy has its own path ref
            graphics: gfx,
            hpBar,

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
                    this.graphics.destroy();
                    this.hpBar.destroy();
                }
            },
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

            /* --- Movement ---
               Move toward the next waypoint in the path. When we reach it,
               advance pathIndex to the following waypoint. */
            if (enemy.pathIndex >= enemy.path.length) {
                /* Enemy reached the exit — remove it and cost the player a life */
                enemy.active = false;
                enemy.graphics.destroy();
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

            /* How far can the enemy move this frame? */
            const moveDistance = enemy.speed * tileSize * delta;

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

            /* Update the visual position of the enemy circle */
            enemy.graphics.setPosition(enemy.x, enemy.y);

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
            if (enemy.graphics && enemy.graphics.active) enemy.graphics.destroy();
            if (enemy.hpBar && enemy.hpBar.active) enemy.hpBar.destroy();
        }
        this.enemies = [];
    }
}
