/* ==========================================================================
   Pathfinder.js — Custom A* Pathfinding (No External Dependencies)
   
   WHY write our own A* instead of using a library?
   The EasyStar.js library uses Node.js-style `require()` which doesn't
   work in a plain browser <script> tag. Rather than adding a bundler,
   we implement A* ourselves. Our grid is small (20×15 = 300 tiles),
   so performance is not a concern.
   
   WHAT IS A*?
   A* (A-Star) is a search algorithm that finds the shortest path between
   two points on a grid. It works like this:
   
   1. Start at the spawn tile. Add it to an "open list" (tiles to explore).
   2. Pick the tile from the open list with the lowest COST.
      Cost = (distance traveled so far) + (estimated distance to goal).
   3. Look at that tile's neighbors (up, down, left, right).
      - If a neighbor is the exit → we found the path! Trace it back.
      - If a neighbor is walkable and not yet explored → add it to the open list.
   4. Repeat until we find the exit or run out of tiles (no path exists).
   
   The "estimated distance to goal" (called the HEURISTIC) is what makes
   A* smarter than brute-force search — it explores tiles that point
   toward the goal first, skipping dead ends early.
   ========================================================================== */

/**
 * Pathfinder — Built-in A* pathfinding for the tower defense grid.
 * 
 * Usage:
 *   const pf = new Pathfinder(gridSystem);
 *   const path = pf.findPath(startCol, startRow, endCol, endRow);
 *   // path = [{ x: col, y: row }, ...] or null if blocked
 */
class Pathfinder {
    /**
     * @param {GridSystem} gridSystem - Reference to the game grid
     */
    constructor(gridSystem) {
        this.gridSystem = gridSystem;
    }

    /**
     * findPath — Calculate the shortest path using A*.
     * 
     * @param {number} startCol - Starting grid column
     * @param {number} startRow - Starting grid row
     * @param {number} endCol   - Target grid column
     * @param {number} endRow   - Target grid row
     * @returns {{x: number, y: number}[]|null} Array of waypoints, or null if no path
     */
    findPath(startCol, startRow, endCol, endRow) {
        const grid = this.gridSystem;
        const rows = grid.rows;
        const cols = grid.cols;

        /* --- Data structures ---
           openList:  tiles we haven't fully explored yet (candidates)
           closedSet: tiles we've already explored (don't revisit)
           cameFrom:  for each tile, which tile did we come from? (to trace the path) 
           gScore:    cost of the cheapest known path from start to this tile
           fScore:    gScore + heuristic estimate to the goal */
        const openList = [];
        const closedSet = new Set();
        const cameFrom = {};
        const gScore = {};
        const fScore = {};

        /* WHY a helper to make string keys?
           JavaScript Sets and object keys need strings. We encode
           (col, row) as "col,row" for fast lookups. */
        const key = (c, r) => `${c},${r}`;

        /* Initialize the start tile */
        const startKey = key(startCol, startRow);
        gScore[startKey] = 0;
        fScore[startKey] = this._heuristic(startCol, startRow, endCol, endRow);
        openList.push({ col: startCol, row: startRow, f: fScore[startKey] });

        /* --- Main A* Loop ---
           Keep exploring until we run out of candidates or find the goal. */
        while (openList.length > 0) {
            /* Pick the tile with the lowest fScore (most promising).
               WHY sort? A proper A* uses a binary heap (priority queue)
               for O(log n) extraction. But with only 300 tiles, sorting
               the array is fast enough and much simpler to understand. */
            openList.sort((a, b) => a.f - b.f);
            const current = openList.shift(); // Remove and return the best tile
            const currentKey = key(current.col, current.row);

            /* Did we reach the goal? Trace the path back to start! */
            if (current.col === endCol && current.row === endRow) {
                return this._reconstructPath(cameFrom, current);
            }

            closedSet.add(currentKey);

            /* Explore all 4 neighbors (up, down, left, right) */
            const neighbors = [
                { col: current.col,     row: current.row - 1 }, // Up
                { col: current.col,     row: current.row + 1 }, // Down
                { col: current.col - 1, row: current.row     }, // Left
                { col: current.col + 1, row: current.row     }, // Right
            ];

            for (const neighbor of neighbors) {
                const nKey = key(neighbor.col, neighbor.row);

                /* Skip if out of bounds or not walkable */
                if (!grid.isWalkable(neighbor.col, neighbor.row)) continue;

                /* Skip if already fully explored */
                if (closedSet.has(nKey)) continue;

                /* Calculate the cost to reach this neighbor through the current tile.
                   WHY +1? Each step to an adjacent tile costs 1 unit. */
                const tentativeG = (gScore[currentKey] || 0) + 1;

                /* Is this a better path to this neighbor than any we've found before? */
                if (tentativeG < (gScore[nKey] ?? Infinity)) {
                    /* Yes! Record this as the best path to this neighbor. */
                    cameFrom[nKey] = current;
                    gScore[nKey] = tentativeG;
                    fScore[nKey] = tentativeG + this._heuristic(
                        neighbor.col, neighbor.row, endCol, endRow
                    );

                    /* Add to open list if not already there */
                    const alreadyOpen = openList.some(
                        n => n.col === neighbor.col && n.row === neighbor.row
                    );
                    if (!alreadyOpen) {
                        openList.push({
                            col: neighbor.col,
                            row: neighbor.row,
                            f: fScore[nKey],
                        });
                    }
                }
            }
        }

        /* If we get here, the open list is empty and we never found the goal.
           This means no path exists (all routes are blocked). */
        return null;
    }

    /**
     * _heuristic — Estimate the distance from (col, row) to (endCol, endRow).
     * 
     * We use "Manhattan Distance" — the sum of horizontal and vertical
     * distances. It's called Manhattan because it measures distance like
     * walking on a city grid (no diagonals), which matches our 4-direction
     * movement.
     * 
     * Syntax breakdown:
     *   Math.abs(col - endCol)  →  horizontal distance (always positive)
     *   Math.abs(row - endRow)  →  vertical distance (always positive)
     *   sum of both             →  total estimated steps
     *
     * @param {number} col
     * @param {number} row
     * @param {number} endCol
     * @param {number} endRow
     * @returns {number} Estimated distance
     * @private
     */
    _heuristic(col, row, endCol, endRow) {
        return Math.abs(col - endCol) + Math.abs(row - endRow);
    }

    /**
     * _reconstructPath — Trace backwards from the goal to the start
     * using the cameFrom map, then reverse it to get start→goal order.
     * 
     * @param {object} cameFrom - Map of "tile key" → previous tile object
     * @param {object} current  - The goal tile we just reached
     * @returns {{x: number, y: number}[]} Array of waypoints
     * @private
     */
    _reconstructPath(cameFrom, current) {
        const path = [{ x: current.col, y: current.row }];
        const keyFn = (c, r) => `${c},${r}`;
        let cur = current;

        /* Walk backwards through the chain of "came from" links */
        while (cameFrom[keyFn(cur.col, cur.row)]) {
            cur = cameFrom[keyFn(cur.col, cur.row)];
            path.unshift({ x: cur.col, y: cur.row });
        }

        return path;
    }

    /**
     * isPathPossible — Check if placing a tower would block ALL routes.
     * 
     * Temporarily blocks the tile, runs A*, then unblocks it.
     *
     * @param {number} col - Column where tower would be placed
     * @param {number} row - Row where tower would be placed
     * @returns {boolean} true if a path still exists after blocking
     */
    isPathPossible(col, row) {
        /* Temporarily block the tile */
        this.gridSystem.blockTile(col, row);

        const spawn = this.gridSystem.spawnTile;
        const exit  = this.gridSystem.exitTile;
        const path  = this.findPath(spawn.col, spawn.row, exit.col, exit.row);

        /* Unblock the tile — we were just testing */
        this.gridSystem.unblockTile(col, row);

        return path !== null;
    }
}
