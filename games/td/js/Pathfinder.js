/* ==========================================================================
   Pathfinder.js — A* Pathfinding Wrapper (uses EasyStar.js)
   
   WHY A* pathfinding?
   In a tower defense game with "mazing" (like Desktop Tower Defense),
   enemies need to dynamically find their way from spawn to exit. When
   the player places a tower on the path, the route changes. A* is the
   industry-standard algorithm for finding the shortest path on a grid.
   
   EasyStar.js does the heavy lifting — this class is a thin wrapper
   that makes it easy for the rest of our code to request paths.
   ========================================================================== */

/**
 * Pathfinder — Wraps EasyStar.js for convenient async path requests.
 * 
 * Usage:
 *   const pf = new Pathfinder(gridSystem);
 *   const path = await pf.findPath(startCol, startRow, endCol, endRow);
 *   // path = [{ x: col, y: row }, { x: col, y: row }, ...]
 */
class Pathfinder {
    /**
     * @param {GridSystem} gridSystem - Reference to the grid (used to
     *   generate the pathfinding array and convert coords)
     */
    constructor(gridSystem) {
        this.gridSystem = gridSystem;

        /* Create a new EasyStar instance.
           WHY new instance per Pathfinder? If we ever need multiple
           pathfinding contexts (e.g., different enemy types with
           different movement rules), each gets its own EasyStar. */
        this.easystar = new EasyStar.js();

        /* Tell EasyStar which tile values mean "walkable".
           In our pathfinding grid (from GridSystem.getPathfindingGrid),
           0 = walkable and 1 = blocked. */
        this.easystar.setAcceptableTiles([0]);

        /* WHY disable diagonals? Classic tower defense games use
           4-directional movement (up/down/left/right) to keep
           path prediction simple and fair for the player. */
        this.easystar.enableDiagonals(false);

        /* Feed the initial grid to EasyStar */
        this._refreshGrid();
    }

    /**
     * _refreshGrid — Re-read the grid from GridSystem and update EasyStar.
     * 
     * Call this every time a tower is placed or sold so the pathfinder
     * knows about the new obstacle layout.
     * 
     * @private
     */
    _refreshGrid() {
        const pfGrid = this.gridSystem.getPathfindingGrid();
        this.easystar.setGrid(pfGrid);
    }

    /**
     * findPath — Calculate a path from (startCol, startRow) to (endCol, endRow).
     * 
     * WHY async (Promise)? EasyStar calculates paths asynchronously to avoid
     * blocking the main thread on large grids. We wrap its callback API in
     * a Promise so callers can use `await`.
     *
     * @param {number} startCol - Starting grid column
     * @param {number} startRow - Starting grid row
     * @param {number} endCol   - Target grid column
     * @param {number} endRow   - Target grid row
     * @returns {Promise<{x: number, y: number}[]|null>} Array of waypoints, or null if no path exists
     */
    findPath(startCol, startRow, endCol, endRow) {
        /* Refresh the grid before every path request so we always use
           the latest tower layout. */
        this._refreshGrid();

        return new Promise((resolve) => {
            this.easystar.findPath(startCol, startRow, endCol, endRow, (path) => {
                if (path === null) {
                    /* WHY resolve(null) instead of reject?
                       A null path means "no route exists" — this is a
                       valid game state (player blocked the only path).
                       We handle it gracefully instead of crashing. */
                    resolve(null);
                } else {
                    resolve(path);
                }
            });

            /* EasyStar requires an explicit calculate() call to process
               queued path requests. We call it immediately since we only
               queue one request at a time. */
            this.easystar.calculate();
        });
    }

    /**
     * isPathPossible — Check if placing a tower would block ALL routes.
     * 
     * WHY this check? If the player blocks every possible path, enemies
     * have nowhere to go. Good TD games prevent this by refusing the
     * placement. We temporarily block the tile, check for a path, then
     * unblock it.
     *
     * @param {number} col - Column where tower would be placed
     * @param {number} row - Row where tower would be placed
     * @returns {Promise<boolean>} true if a path still exists after blocking
     */
    async isPathPossible(col, row) {
        /* Temporarily block the tile */
        this.gridSystem.blockTile(col, row);

        const spawn = this.gridSystem.spawnTile;
        const exit  = this.gridSystem.exitTile;
        const path  = await this.findPath(spawn.col, spawn.row, exit.col, exit.row);

        /* Unblock the tile — we were just testing */
        this.gridSystem.unblockTile(col, row);

        return path !== null;
    }
}
