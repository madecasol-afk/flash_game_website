/* ==========================================================================
   GridSystem.js — The Game Map as a 2D Array
   
   WHY a grid system?
   Tower defense games are fundamentally about a GRID. Every tile is either:
   - Buildable (player can place a tower)
   - Path (enemies walk on it)
   - Blocked (a tower already occupies it)
   
   By representing the map as a simple 2D array of numbers, we can:
   1. Quickly check "can I build here?" → just look up grid[row][col]
   2. Feed the array to EasyStar for A* pathfinding
   3. Re-calculate paths instantly when a tower is placed or sold
   ========================================================================== */

/**
 * GridSystem — Manages the tile grid state.
 * 
 * Think of this as the "game board" in a board game. It knows which
 * squares are empty, which have towers, and which are part of the
 * enemy path.
 */
class GridSystem {
    /**
     * @param {number[][]} layout - 2D array from GAME_CONFIG.mapLayout
     * @param {number} tileSize  - Pixel size of each tile
     */
    constructor(layout, tileSize) {
        this.tileSize = tileSize;
        this.rows = layout.length;
        this.cols = layout[0].length;

        /* WHY deep-copy the layout?
           We will mutate this grid (marking tiles as blocked when towers
           are placed). We don't want to accidentally change the original
           config, which we might need to reset the level. */
        this.grid = layout.map(row => [...row]);

        /* Cache the spawn and exit positions so other modules don't
           have to search for them every time. */
        this.spawnTile = this._findTile(2); // tile value 2 = spawn
        this.exitTile  = this._findTile(3); // tile value 3 = exit
    }

    /**
     * _findTile — Scans the grid for the first tile matching `value`.
     * 
     * @param {number} value - The tile code to search for (e.g. 2 for spawn)
     * @returns {{ col: number, row: number }} Grid coordinates
     * @private
     */
    _findTile(value) {
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (this.grid[r][c] === value) {
                    return { col: c, row: r };
                }
            }
        }
        // WHY warn instead of crash? Helps us debug missing spawn/exit tiles.
        console.warn(`GridSystem: tile value ${value} not found in layout!`);
        return { col: 0, row: 0 };
    }

    /**
     * isBuildable — Can the player place a tower on this tile?
     * 
     * Only tiles with value 0 (grass) are buildable. Path tiles (1),
     * spawn (2), exit (3), and already-blocked tiles (9) are off-limits.
     *
     * @param {number} col - Grid column
     * @param {number} row - Grid row
     * @returns {boolean}
     */
    isBuildable(col, row) {
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) {
            return false; // Out of bounds
        }
        return this.grid[row][col] === 0;
    }

    /**
     * blockTile — Mark a tile as occupied by a tower.
     * 
     * We use value 9 to mean "tower here". This tells the pathfinder
     * to route enemies around this tile.
     *
     * @param {number} col - Grid column
     * @param {number} row - Grid row
     */
    blockTile(col, row) {
        this.grid[row][col] = 9;
    }

    /**
     * unblockTile — Free a tile (e.g., when a tower is sold).
     * 
     * @param {number} col - Grid column
     * @param {number} row - Grid row
     */
    unblockTile(col, row) {
        this.grid[row][col] = 0;
    }

    /**
     * isWalkable — Can an enemy walk on this tile?
     * 
     * Enemies can walk on path (1), spawn (2), and exit (3) tiles.
     * They CANNOT walk on grass (0) or tower-blocked (9) tiles.
     *
     * @param {number} col - Grid column
     * @param {number} row - Grid row
     * @returns {boolean}
     */
    isWalkable(col, row) {
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) {
            return false;
        }
        const val = this.grid[row][col];
        return val === 1 || val === 2 || val === 3;
    }

    /**
     * tileToPixel — Convert grid coordinates to pixel coordinates.
     * 
     * Returns the CENTER of the tile (not the top-left corner), which
     * is what Phaser sprites expect for their position.
     *
     * @param {number} col - Grid column
     * @param {number} row - Grid row
     * @returns {{ x: number, y: number }} Pixel coordinates (centre of tile)
     */
    tileToPixel(col, row) {
        return {
            x: col * this.tileSize + this.tileSize / 2,
            y: row * this.tileSize + this.tileSize / 2,
        };
    }

    /**
     * pixelToTile — Convert pixel coordinates to grid coordinates.
     * 
     * Uses Math.floor to snap to the tile the cursor is hovering over.
     *
     * @param {number} x - Pixel X
     * @param {number} y - Pixel Y
     * @returns {{ col: number, row: number }} Grid coordinates
     */
    pixelToTile(x, y) {
        return {
            col: Math.floor(x / this.tileSize),
            row: Math.floor(y / this.tileSize),
        };
    }

    /**
     * getPathfindingGrid — Returns a grid formatted for EasyStar.
     * 
     * EasyStar needs a 2D array where 0 = walkable and everything
     * else is blocked. We invert our convention:
     * - Our path/spawn/exit (1, 2, 3) → EasyStar walkable (0)
     * - Everything else → EasyStar blocked (1)
     *
     * @returns {number[][]} Grid for EasyStar.setGrid()
     */
    getPathfindingGrid() {
        return this.grid.map(row =>
            row.map(tile => {
                /* WHY this ternary?
                   Tiles 1 (path), 2 (spawn), 3 (exit) are walkable for enemies.
                   Everything else (0 = grass, 9 = tower) is a wall. */
                return (tile === 1 || tile === 2 || tile === 3) ? 0 : 1;
            })
        );
    }
}
