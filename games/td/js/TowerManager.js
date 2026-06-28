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

        /* Draw the tower as a colored square with a border relative to (0,0).
           WHY? By drawing the shape relative to (0,0) and using gfx.setPosition() to place it,
           we make it incredibly easy to move the graphics object later during the "Move Mode" drag. */
        const gfx = this.scene.add.graphics();
        gfx.fillStyle(towerDef.color, 1);
        gfx.fillRoundedRect(
            -tileSize * 0.4,
            -tileSize * 0.4,
            tileSize * 0.8,
            tileSize * 0.8,
            4
        );
        /* White border to make towers stand out against the grid */
        gfx.lineStyle(2, 0xffffff, 0.5);
        gfx.strokeRoundedRect(
            -tileSize * 0.4,
            -tileSize * 0.4,
            tileSize * 0.8,
            tileSize * 0.8,
            4
        );
        gfx.setPosition(pos.x, pos.y);

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

        // Recalculate booster buffs across the grid now that a new tower is placed.
        // WHY? If we built a Buffer tower, it should instantly boost adjacent towers. If we built a regular tower
        // next to a Buffer, it should receive the buff immediately.
        this.recalculateBuffs();

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
             if (tower.fireRate === 0) {
                 continue; // Utility tower (Gold Miner or Buffer) — does not fire projectiles
             }

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
        // --- Tesla Coil Special Case: Chain Lightning ---
        // WHY? Tesla lightning jumps between multiple enemies in a jagged electrical path, which requires custom recursive logic.
        if (tower.type === 'tesla') {
            this._fireChainLightning(tower, target, towerPos, enemies);
            return;
        }

        const tileSize = this.gridSystem.tileSize;

        // Customise projectile line styles based on the tower type.
        // WHY? Color-coded lasers instantly tell the player which tower is hitting which enemy.
        let beamColor = 0xffffff; // Default white
        let beamWidth = 2;        // Default 2px
        
        switch (tower.type) {
            case 'slower':
                beamColor = 0x3498db; // Ice blue
                break;
            case 'poisoner':
                beamColor = 0x2ecc71; // Acid green
                break;
            case 'laser':
                beamColor = 0x9b59b6; // Rapid purple
                beamWidth = 1.5;
                break;
            case 'doomray':
                beamColor = 0xe74c3c; // Thick crimson red
                beamWidth = 4;
                break;
        }

        /* Draw a quick projectile line from tower to enemy. */
        const line = this.scene.add.graphics();
        line.lineStyle(beamWidth, beamColor, 0.8);
        line.beginPath();
        line.moveTo(towerPos.x, towerPos.y);
        line.lineTo(target.x, target.y);
        line.strokePath();

        /* Fade and remove the projectile line after 100ms. */
        this.scene.tweens.add({
            targets: line,
            alpha: 0,
            duration: 100,
            onComplete: () => line.destroy(),
        });

        // --- Apply Damage and Effects ---
        
        // Apply Special Status Effects based on tower type:
        if (tower.type === 'slower') {
            // Frost Slow Effect: Reduces enemy speed.
            const def = GAME_CONFIG.towers.slower;
            let mult = def.slowMultiplier;
            let dur = def.slowDuration;
            
            // Read upgrades if upgraded
            for (let i = 0; i < tower.level; i++) {
                mult = def.upgrades[i].slowMultiplier ?? mult;
                dur = def.upgrades[i].range ?? dur; // wait, let's keep dur constant or scale
            }
            
            target.takeSlow(mult, dur);
        }
        else if (tower.type === 'poisoner') {
            // Acid Poison DOT Effect: Deals damage over time.
            const def = GAME_CONFIG.towers.poisoner;
            let tickDmg = def.poisonDamage;
            let dur = def.poisonDuration;
            
            for (let i = 0; i < tower.level; i++) {
                tickDmg = def.upgrades[i].poisonDamage ?? tickDmg;
            }
            
            target.takePoison(tickDmg, dur);
        }

        // Apply normal hit damage
        if (tower.damage > 0) {
            if (tower.splashRadius > 0) {
                /* Splash towers damage ALL enemies within the splash radius. */
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

    /**
     * pickUpTower — Pick up a placed tower to move it.
     * 
     * Purpose:
     * This method converts the raw click position into grid coordinates, finds
     * the tower at that tile, and marks it as the "moving tower". It unblocks the
     * tile in the grid system so it is no longer considered occupied. It also
     * lowers the opacity of the tower graphics to give a "ghost" drag effect.
     *
     * @param {number} pixelX - Click X coordinate in pixels
     * @param {number} pixelY - Click Y coordinate in pixels
     * @returns {boolean} True if a tower was successfully picked up
     */
    pickUpTower(pixelX, pixelY) {
        // Convert screen coordinates to grid coordinates.
        const { col, row } = this.gridSystem.pixelToTile(pixelX, pixelY);

        // Find the tower at this grid tile.
        // SYNTAX BREAKDOWN:
        // - Array.prototype.find() returns the first element in the array that matches the condition.
        const tower = this.towers.find(t => t.col === col && t.row === row);

        // If no tower was found, we cannot pick anything up.
        if (!tower) {
            return false;
        }

        // Store this tower as the one currently being moved.
        this.movingTower = tower;

        // Unblock this tile in the grid system.
        // WHY? While the player is dragging the tower around, that tile should be free
        // for other towers to be placed, or for enemies to pass through.
        this.gridSystem.unblockTile(col, row);

        // Make the tower semi-transparent to visually indicate it has been picked up.
        // WHY? It gives the player feedback that the tower is in a "ghost" state.
        tower.graphics.setAlpha(0.5);

        return true;
    }

    /**
     * dropTower — Place the currently picked up tower at a new tile location.
     * 
     * Purpose:
     * This method checks if the snapped tile under the cursor is valid (buildable
     * and doesn't block the enemy path). If it is, it snaps the tower to the new grid
     * position, updates its properties, resets its opacity, blocks the new tile,
     * and clears the moving tower state.
     *
     * @param {number} pixelX - Click X coordinate in pixels
     * @param {number} pixelY - Click Y coordinate in pixels
     * @returns {boolean} True if the tower was successfully placed at the new location
     */
    dropTower(pixelX, pixelY) {
        // If there is no tower being moved, do nothing.
        if (!this.movingTower) {
            return false;
        }

        // Convert raw click coordinates to grid coordinates.
        const { col, row } = this.gridSystem.pixelToTile(pixelX, pixelY);

        // Check if the tile is buildable (grass, no existing tower).
        // WHY? We can't drop a tower on a path or on top of another tower.
        if (!this.gridSystem.isBuildable(col, row)) {
            return false;
        }

        // Validate that dropping the tower here won't block all pathfinding routes.
        // WHY? Same reason as normal placement — we can't completely trap enemies.
        const pathStillExists = this.pathfinder.isPathPossible(col, row);
        if (!pathStillExists) {
            return false;
        }

        // Update the tower's grid coordinates to the new values.
        this.movingTower.col = col;
        this.movingTower.row = row;

        // Get the pixel center of the new tile.
        const pos = this.gridSystem.tileToPixel(col, row);

        // Snap the graphics object to the center of the new tile.
        this.movingTower.graphics.setPosition(pos.x, pos.y);

        // Restore the full opacity of the tower graphics.
        this.movingTower.graphics.setAlpha(1.0);

        // Block this new tile in the grid system.
        this.gridSystem.blockTile(col, row);

        // Recalculate booster buffs across the grid now that a tower is dropped in a new position.
        // WHY? If we moved a Buffer, it should buff its new neighbors and remove buffs from old ones.
        this.recalculateBuffs();

        // Clear the moving state.
        this.movingTower = null;

        return true;
    }

    /**
     * cancelMove — Return the moving tower to its original coordinates if the move is cancelled.
     * 
     * Purpose:
     * If the player cancels the move, we put the tower back to where it was picked up,
     * restore its full opacity, and block its original grid tile again.
     */
    cancelMove() {
        if (!this.movingTower) return;

        // Restore the tower graphics to its original position.
        const pos = this.gridSystem.tileToPixel(this.movingTower.col, this.movingTower.row);
        this.movingTower.graphics.setPosition(pos.x, pos.y);
        this.movingTower.graphics.setAlpha(1.0);

        // Block the original tile in the grid system again.
        this.gridSystem.blockTile(this.movingTower.col, this.movingTower.row);

        // Recalculate booster buffs now that the moved tower has returned to its starting spot.
        this.recalculateBuffs();

        // Reset the moving tower state.
        this.movingTower = null;
    }

    /**
     * _fireChainLightning — Fires an electrical bolt that jumps between multiple nearby enemies.
     * 
     * Purpose:
     * Handles hitting a primary target, then iteratively searching for the closest active enemy
     * within a set jump radius, drawing lightning links, and applying damage to each target.
     *
     * @param {object} tower - The Tesla tower firing
     * @param {object} target - The primary enemy target
     * @param {object} towerPos - Center coordinates of the tower
     * @param {object[]} enemies - List of all active enemies on screen
     * @private
     */
    _fireChainLightning(tower, target, towerPos, enemies) {
        const def = GAME_CONFIG.towers.tesla;
        let chainTargets = def.chainTargets;

        // Sum upgrades if any
        for (let i = 0; i < tower.level; i++) {
            chainTargets = def.upgrades[i].chainTargets;
        }

        // Keep track of enemies already hit to prevent the lightning from bouncing back and forth
        // between the same two enemies.
        const hitEnemies = new Set();
        let currentSource = towerPos;
        let currentTarget = target;
        let jumps = 0;

        const maxJumpDistance = 120; // 3 tiles (in pixels) for lightning to jump

        while (currentTarget && jumps < chainTargets) {
            // Apply damage to current target
            currentTarget.takeDamage(tower.damage);
            hitEnemies.add(currentTarget);
            jumps++;

            // Draw a zig-zag lightning line from currentSource to currentTarget
            this._drawLightningBolt(currentSource.x, currentSource.y, currentTarget.x, currentTarget.y);

            // Find next target for the chain jump
            let nextTarget = null;
            let closestDist = Infinity;

            for (const enemy of enemies) {
                // Skip if the enemy is dead, out of range, or already hit by this lightning chain
                if (!enemy.active || hitEnemies.has(enemy)) continue;

                const dx = enemy.x - currentTarget.x;
                const dy = enemy.y - currentTarget.y;
                const distSq = dx * dx + dy * dy;

                // Check if target is close enough and closer than other candidates
                if (distSq <= maxJumpDistance * maxJumpDistance && distSq < closestDist) {
                    closestDist = distSq;
                    nextTarget = enemy;
                }
            }

            // Update parameters for the next chain jump
            currentSource = currentTarget;
            currentTarget = nextTarget;
        }
    }

    /**
     * _drawLightningBolt — Draws a jagged electrical bolt from (x1, y1) to (x2, y2).
     * 
     * Purpose:
     * Generates a realistic electric spark by dividing the distance between points into
     * small segments, offsetting the intermediate points perpendicularly by a random amount,
     * and drawing line segments connecting them.
     *
     * @param {number} x1 - Source X
     * @param {number} y1 - Source Y
     * @param {number} x2 - Destination X
     * @param {number} y2 - Destination Y
     * @private
     */
    _drawLightningBolt(x1, y1, x2, y2) {
        const bolt = this.scene.add.graphics();
        bolt.lineStyle(2.5, 0xf1c40f, 1.0); // Bright electrical yellow
        bolt.beginPath();
        bolt.moveTo(x1, y1);

        const dx = x2 - x1;
        const dy = x2 - x1; // wait, let's make sure this is dy = y2 - y1!
        const correctDy = y2 - y1;
        const dist = Math.sqrt(dx * dx + correctDy * correctDy);
        
        // Divide the line into 20px long segments
        const segments = Math.max(3, Math.floor(dist / 20));

        for (let i = 1; i < segments; i++) {
            const fraction = i / segments;
            // Linear interpolation (lerp) coordinates along the straight line
            const px = x1 + dx * fraction;
            const py = y1 + correctDy * fraction;

            // Perpendicular offset for electrical jagging
            // SYNTAX BREAKDOWN:
            // - `(Math.random() - 0.5) * 16` gives a random number between -8 and +8.
            // - `perpX` and `perpY` represent the perpendicular direction (normal vector) to the line.
            const offset = (Math.random() - 0.5) * 16;
            const perpX = -correctDy / dist;
            const perpY = dx / dist;

            bolt.lineTo(px + perpX * offset, py + perpY * offset);
        }

        // Finish at the destination
        bolt.lineTo(x2, y2);
        bolt.strokePath();

        // Fade away and destroy the graphics object to avoid memory leaks.
        this.scene.tweens.add({
            targets: bolt,
            alpha: 0,
            duration: 150,
            onComplete: () => bolt.destroy()
        });
    }

    /**
     * recalculateBuffs — Recalculates Buffer/Booster tower damage multipliers for surrounding towers.
     * 
     * Purpose:
     * Scans the grid. Resets all towers to their base damage stats (including upgrade stats),
     * finds all Buffer/Booster towers, and applies a damage multiplier to all towers situated
     * in their immediate 3x3 surrounding tiles.
     */
    recalculateBuffs() {
        // Step 1: Reset all towers back to their base stats (clean data before applying buffs)
        // WHY? If we sold a buffer or moved a tower away, we need to clear the old buffs first,
        // otherwise towers would stack buffs permanently or keep buffs they shouldn't have.
        for (const tower of this.towers) {
            const def = GAME_CONFIG.towers[tower.type];
            let baseDamage = def.damage;
            let baseRange = def.range;
            
            // Re-apply upgrade stats based on current tier level
            for (let i = 0; i < tower.level; i++) {
                baseDamage = def.upgrades[i].damage ?? baseDamage;
                baseRange = def.upgrades[i].range ?? baseRange;
            }
            
            tower.damage = baseDamage;
            tower.range = baseRange;
        }

        // Step 2: Find all active Buffer towers
        const buffers = this.towers.filter(t => t.type === 'booster');

        // Step 3: For each Buffer tower, apply its damage multiplier to adjacent towers
        for (const buffer of buffers) {
            const def = GAME_CONFIG.towers.booster;
            let multiplier = def.buffMultiplier;
            
            // Sum upgrade multiplier if the Buffer tower is upgraded
            for (let i = 0; i < buffer.level; i++) {
                multiplier = def.upgrades[i].buffMultiplier ?? multiplier;
            }

            // Loop through all placed towers to find targets within the 3x3 surrounding area
            for (const target of this.towers) {
                if (target === buffer) continue; // A Buffer cannot buff itself!

                // Calculate distance in grid coordinates
                const colDiff = Math.abs(target.col - buffer.col);
                const rowDiff = Math.abs(target.row - buffer.row);

                // If within 1 tile grid distance in both directions (immediate neighbors on 3x3 grid)
                if (colDiff <= 1 && rowDiff <= 1) {
                    // Multiply target damage and round to avoid fractional numbers.
                    target.damage = Math.round(target.damage * multiplier);
                }
            }
        }
    }
}

