/* ==========================================================================
   TowerManager.js — Tower Placement, Rendering, and Attack Logic
   
   WHY a separate manager?
   Keeping tower logic in its own class follows the "Single Responsibility
   Principle": TowerManager only cares about towers. It doesn't know how
   enemies move or how waves spawn. This makes it easy to test, debug,
   and modify tower behaviour without touching other systems.
   ========================================================================== */

/**
 * TowerManager — Handles placing, upgrading, rendering, and firing towers.
 * 
 * Each tower is stored as a plain object in the `this.towers` array:
 * {
 *   col, row,          — grid position
 *   type,              — 'basic', 'splash', or 'sniper'
 *   level,             — 0, 1, or 2 (upgrade tier)
 *   damage, range, ... — stats (copied from config, modified by upgrades)
 *   lastFired,         — timestamp of last shot (for fire rate limiting)
 *   graphics,          — Phaser graphics object for rendering
 * }
 */
class TowerManager {
    /**
     * @param {Phaser.Scene} scene       - The active Phaser scene
     * @param {GridSystem}   gridSystem  - Grid reference for coord conversions
     * @param {Pathfinder}   pathfinder  - Pathfinder to validate placements
     */
    constructor(scene, gridSystem, pathfinder) {
        this.scene = scene;
        this.gridSystem = gridSystem;
        this.pathfinder = pathfinder;
        this.towers = [];

        /* WHY track selectedType here?
           The HTML tower shop buttons set this value. When the player
           clicks on the canvas, we read selectedType to know which
           tower to place. null means "no tower selected". */
        this.selectedType = null;
    }

    /**
     * selectTower — Called by the UI when a tower button is clicked.
     * 
     * @param {string|null} type - 'basic', 'splash', 'sniper', or null to deselect
     */
    selectTower(type) {
        this.selectedType = type;
    }

    /**
     * placeTower — Attempt to place a tower at the given pixel position.
     * 
     * This method validates the placement (is it buildable? can we afford
     * it? does it block all paths?) before actually creating the tower.
     *
     * @param {number} pixelX  - Click X in canvas pixels
     * @param {number} pixelY  - Click Y in canvas pixels
     * @param {number} gold    - Player's current gold
     * @returns {{success: boolean, cost: number}}
     */
    placeTower(pixelX, pixelY, gold) {
        /* Step 1: No tower type selected → do nothing */
        if (!this.selectedType) {
            return { success: false, cost: 0 };
        }

        /* Step 2: Convert click position to grid coordinates */
        const { col, row } = this.gridSystem.pixelToTile(pixelX, pixelY);

        /* Step 3: Check if the tile is buildable (grass, no existing tower) */
        if (!this.gridSystem.isBuildable(col, row)) {
            return { success: false, cost: 0 };
        }

        /* Step 4: Check if player can afford it */
        const towerDef = GAME_CONFIG.towers[this.selectedType];
        if (gold < towerDef.cost) {
            return { success: false, cost: 0 };
        }

        /* Step 5: Check that placing here won't block ALL enemy paths.
           WHY? If there's no route from spawn to exit, enemies would
           get stuck. Good tower defense games prevent this. */
        const pathStillExists = this.pathfinder.isPathPossible(col, row);
        if (!pathStillExists) {
            return { success: false, cost: 0 };
        }

        /* Step 6: All checks passed — create the tower! */
        this.gridSystem.blockTile(col, row);

        const pos = this.gridSystem.tileToPixel(col, row);
        const tileSize = this.gridSystem.tileSize;

        /* Draw the tower as a colored square with a border.
           WHY not sprites? For the MVP, colored shapes are fast to
           implement and easy to distinguish. We'll add sprite sheets
           in a later polish pass. */
        const gfx = this.scene.add.graphics();
        gfx.fillStyle(towerDef.color, 1);
        gfx.fillRoundedRect(
            pos.x - tileSize * 0.4,
            pos.y - tileSize * 0.4,
            tileSize * 0.8,
            tileSize * 0.8,
            4
        );
        /* White border to make towers stand out against the grid */
        gfx.lineStyle(2, 0xffffff, 0.5);
        gfx.strokeRoundedRect(
            pos.x - tileSize * 0.4,
            pos.y - tileSize * 0.4,
            tileSize * 0.8,
            tileSize * 0.8,
            4
        );

        /* Store the tower data */
        const tower = {
            col,
            row,
            type: this.selectedType,
            level: 0,
            damage: towerDef.damage,
            range: towerDef.range,
            fireRate: towerDef.fireRate,
            splashRadius: towerDef.splashRadius,
            lastFired: 0,
            graphics: gfx,
        };
        this.towers.push(tower);

        return { success: true, cost: towerDef.cost };
    }

    /**
     * update — Called every frame. Each tower checks for enemies in range
     * and fires if its cooldown has expired.
     * 
     * @param {number} time     - Current game time in ms (from Phaser)
     * @param {object[]} enemies - Array of active enemy objects from EnemyManager
     */
    update(time, enemies) {
        const tileSize = this.gridSystem.tileSize;

        for (const tower of this.towers) {
            /* WHY check cooldown? Each tower has a fire rate (shots/sec).
               We compare the elapsed time since the last shot to decide
               if the tower can fire again. */
            const cooldownMs = 1000 / tower.fireRate;
            if (time - tower.lastFired < cooldownMs) {
                continue; // Still on cooldown — skip this tower
            }

            /* Convert tower range from tiles to pixels for distance checks */
            const rangePixels = tower.range * tileSize;
            const towerPos = this.gridSystem.tileToPixel(tower.col, tower.row);

            /* Find the closest enemy within range.
               WHY "closest"? This is the simplest targeting strategy and
               matches what most classic TD games use. Later we can add
               "first" (closest to exit) or "strongest" targeting modes. */
            let closestEnemy = null;
            let closestDist = Infinity;

            for (const enemy of enemies) {
                if (!enemy.active) continue; // Skip dead enemies

                const dx = enemy.x - towerPos.x;
                const dy = enemy.y - towerPos.y;
                /* WHY skip Math.sqrt? Comparing squared distances is faster
                   and gives the same ordering. Classic game dev optimisation. */
                const distSq = dx * dx + dy * dy;

                if (distSq <= rangePixels * rangePixels && distSq < closestDist) {
                    closestDist = distSq;
                    closestEnemy = enemy;
                }
            }

            if (closestEnemy) {
                tower.lastFired = time;
                this._fireAt(tower, closestEnemy, towerPos, enemies);
            }
        }
    }

    /**
     * _fireAt — Fire a projectile (visual + damage) at an enemy.
     * 
     * @param {object} tower    - The tower that's firing
     * @param {object} target   - The enemy being targeted
     * @param {object} towerPos - { x, y } pixel position of the tower
     * @param {object[]} enemies - All enemies (needed for splash damage)
     * @private
     */
    _fireAt(tower, target, towerPos, enemies) {
        const tileSize = this.gridSystem.tileSize;

        /* Draw a quick projectile line from tower to enemy.
           WHY a line instead of a moving bullet? For the MVP, an instant
           "laser" effect is much simpler to implement. Moving projectiles
           require tracking flight time and possibly missing the target. */
        const line = this.scene.add.graphics();
        line.lineStyle(2, 0xffffff, 0.8);
        line.beginPath();
        line.moveTo(towerPos.x, towerPos.y);
        line.lineTo(target.x, target.y);
        line.strokePath();

        /* Fade and remove the projectile line after 100ms.
           WHY tween? Phaser's tween system handles the animation off the
           main logic thread, keeping our update loop clean. */
        this.scene.tweens.add({
            targets: line,
            alpha: 0,
            duration: 100,
            onComplete: () => line.destroy(),
        });

        /* Apply damage */
        if (tower.splashRadius > 0) {
            /* Splash towers damage ALL enemies within the splash radius
               centred on the target's position. */
            const splashPixels = tower.splashRadius * tileSize;
            for (const enemy of enemies) {
                if (!enemy.active) continue;
                const dx = enemy.x - target.x;
                const dy = enemy.y - target.y;
                if (dx * dx + dy * dy <= splashPixels * splashPixels) {
                    enemy.takeDamage(tower.damage);
                }
            }
        } else {
            /* Single-target towers only hit the one enemy */
            target.takeDamage(tower.damage);
        }
    }

    /**
     * sellTower — Attempt to sell an existing tower at the clicked pixel position.
     * 
     * Purpose:
     * This method converts the screen click to grid coordinates, searches our
     * active towers list for a match, calculates the refund amount (70% of the
     * original cost plus upgrades), removes the tower graphics from Phaser,
     * unblocks the grid tile, and deletes the tower from our array.
     *
     * @param {number} pixelX - Click X coordinate in pixels
     * @param {number} pixelY - Click Y coordinate in pixels
     * @returns {{success: boolean, refund: number}} Results of the sell action
     */
    sellTower(pixelX, pixelY) {
        // Convert the raw pixel coordinates (where the player clicked) into grid indices (column and row).
        // WHY? The grid handles coordinate snapping. A tile is 40x40 pixels, so clicking anywhere inside
        // that 40x40 boundary will resolve to the exact column and row of that tile.
        const { col, row } = this.gridSystem.pixelToTile(pixelX, pixelY);

        // Search the `this.towers` array to find the index of the tower at this location.
        // SYNTAX BREAKDOWN:
        // - Array.prototype.findIndex() loops through every tower in the array.
        // - It evaluates the arrow function: `(t) => t.col === col && t.row === row`.
        // - If it finds a match, it returns the 0-indexed position (e.g. 0, 1, 2...).
        // - If no match is found, it returns -1.
        const towerIndex = this.towers.findIndex(t => t.col === col && t.row === row);

        // If no tower exists at the clicked tile, findIndex returns -1.
        // WHY return early? We cannot sell a tower that isn't there, so we tell the caller it failed.
        if (towerIndex === -1) {
            return { success: false, refund: 0 };
        }

        // Get the actual tower object from our list.
        const tower = this.towers[towerIndex];

        // Retrieve the configuration data for this specific tower type (e.g. basic blaster cost).
        const towerDef = GAME_CONFIG.towers[tower.type];

        // Calculate refund amount.
        // WHY 70%? It's a standard tower-defense game balancing rule. If players got 100% back,
        // they could dynamically move their entire defense instantly with zero strategic penalty.
        // A 30% loss forces players to plan their layout more carefully.
        const baseRefundRatio = 0.7;
        let totalCost = towerDef.cost;

        // If the tower has been upgraded, add the upgrade costs to the total calculation.
        // SYNTAX BREAKDOWN:
        // - `tower.level` tracks how many upgrades have been applied (0 = base, 1 = first upgrade, etc.).
        // - We loop from `i = 0` up to `tower.level - 1` to sum the cost of each upgrade applied.
        for (let i = 0; i < tower.level; i++) {
            totalCost += towerDef.upgrades[i].cost;
        }

        // Round to avoid fractional gold values (e.g., 17.5 gold).
        const refundAmount = Math.round(totalCost * baseRefundRatio);

        // Clean up the visuals of the tower.
        // WHY? Phaser keeps sprites/drawings in its rendering engine. If we just delete the tower
        // from our array, the colored square would remain drawn on the screen forever.
        // Calling `.destroy()` removes the graphics object from Phaser's rendering queue completely.
        tower.graphics.destroy();

        // Mark this tile on the map as empty (buildable grass) again.
        // WHY? This allows future towers to be placed here, and lets enemies walk through
        // if this was part of the original path (the A* algorithm will utilize it again).
        this.gridSystem.unblockTile(col, row);

        // Remove the tower from our tracker array.
        // SYNTAX BREAKDOWN:
        // - Array.prototype.splice(startIndex, deleteCount) modifies the array in place.
        // - `towerIndex` is where the target tower resides.
        // - `1` means remove exactly 1 element starting from that index.
        this.towers.splice(towerIndex, 1);

        // Return success and the calculated refund amount back to the main game scene.
        return { success: true, refund: refundAmount };
    }
}

