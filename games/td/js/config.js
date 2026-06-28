/* ==========================================================================
   config.js — Game Configuration (Data-Driven Design)
   
   WHY put all numbers here instead of hard-coding them?
   When we need to balance the game (e.g., make the sniper cheaper or
   enemies faster), we only edit ONE file. No hunting through 10 files
   to find where "damage = 15" was set.
   ========================================================================== */

/**
 * GAME_CONFIG
 * 
 * The single source of truth for all game parameters.
 * Every module (TowerManager, EnemyManager, WaveManager) reads from
 * this object instead of defining its own magic numbers.
 *
 * @type {Object}
 */
const GAME_CONFIG = {

    /* --- Grid Settings ---
       WHY 20×15 at 40px? This gives us an 800×600 canvas which is a
       classic resolution for browser games. It's large enough to feel
       strategic but small enough to render fast on low-end machines. */
    grid: {
        cols: 20,        // Number of columns in the tile grid
        rows: 15,        // Number of rows in the tile grid
        tileSize: 40,    // Pixel size of each square tile
    },

    /* --- Canvas Size (derived from grid) --- */
    get canvasWidth()  { return this.grid.cols * this.grid.tileSize; },  // 800px
    get canvasHeight() { return this.grid.rows * this.grid.tileSize; },  // 600px

    /* --- Player Starting Stats --- */
    player: {
        startGold: 100,
        startLives: 20,
    },

    /* --- Tower Definitions ---
       Each tower has: cost, range (in tiles), damage per hit,
       fireRate (shots per second), color (for placeholder rendering),
       and splashRadius (0 = single-target).
       
       WHY three tower types? Benchmarking Bloons TD and Kingdom Rush
       showed that variety forces the player to think about composition,
       not just spam one tower type. */
    towers: {
        basic: {
            name: 'Blaster',
            description: 'Shoots quick plasma bolts. Good starting option.',
            cost: 25,
            tier: 1,
            unlockWave: 0,
            range: 3,          // tiles
            damage: 10,
            fireRate: 1.5,     // shots per second
            color: 0x4ecdc4,   // teal
            splashRadius: 0,   // single target
            upgrades: [
                { cost: 20, damage: 15, range: 3.5 },
                { cost: 40, damage: 25, range: 4   },
            ],
        },
        splash: {
            name: 'Cannon',
            description: 'Fires slow explosive shells. Deals area damage.',
            cost: 50,
            tier: 1,
            unlockWave: 0,
            range: 2.5,
            damage: 20,
            fireRate: 0.8,
            color: 0xff6b6b,   // coral red
            splashRadius: 1.5, // tiles
            upgrades: [
                { cost: 35, damage: 30, splashRadius: 2   },
                { cost: 60, damage: 50, splashRadius: 2.5 },
            ],
        },
        sniper: {
            name: 'Sniper',
            description: 'Extreme range and massive damage, but slow reload.',
            cost: 75,
            tier: 1,
            unlockWave: 0,
            range: 6,
            damage: 50,
            fireRate: 0.4,
            color: 0xffd93d,   // gold
            splashRadius: 0,
            upgrades: [
                { cost: 50, damage: 80, range: 7 },
                { cost: 80, damage: 120, range: 8 },
            ],
        },
        slower: {
            name: 'Frost',
            description: 'Zero damage. Emits frost beams that slow targets by 50%.',
            cost: 60,
            tier: 2,
            unlockWave: 2,
            range: 2,
            damage: 0,
            fireRate: 1.0,
            color: 0x3498db,   // ice blue
            splashRadius: 0,
            slowMultiplier: 0.5, // 50% speed reduction
            slowDuration: 2.0,   // 2 seconds slow duration
            upgrades: [
                { cost: 40, range: 2.5, slowMultiplier: 0.4 }, // slow by 60%
                { cost: 60, range: 3.0, slowMultiplier: 0.3 }, // slow by 70%
            ],
        },
        poisoner: {
            name: 'Acid Spitter',
            description: 'Infects targets with acid, dealing damage over time.',
            cost: 80,
            tier: 2,
            unlockWave: 2,
            range: 3.5,
            damage: 5,         // Initial hit damage
            fireRate: 1.0,
            color: 0x2ecc71,   // green
            splashRadius: 0,
            poisonDamage: 8,     // Damage per tick
            poisonDuration: 4.0, // Deals damage over 4 seconds
            upgrades: [
                { cost: 50, damage: 8, poisonDamage: 15 },
                { cost: 75, damage: 12, poisonDamage: 25 },
            ],
        },
        laser: {
            name: 'Laser Beam',
            description: 'Continuously melts targets with rapid low-damage energy ticks.',
            cost: 100,
            tier: 2,
            unlockWave: 2,
            range: 2.5,
            damage: 2,
            fireRate: 10.0,    // 10 shots per second!
            color: 0x9b59b6,   // purple
            splashRadius: 0,
            upgrades: [
                { cost: 60, damage: 4, range: 3.0 },
                { cost: 90, damage: 8, range: 3.5 },
            ],
        },
        booster: {
            name: 'Buffer',
            description: 'Zero damage. Boosts damage of adjacent towers by 25%.',
            cost: 120,
            tier: 3,
            unlockWave: 5,
            range: 1.5,        // Enough to touch surrounding tiles
            damage: 0,
            fireRate: 0,
            color: 0xe67e22,   // orange
            splashRadius: 0,
            buffMultiplier: 1.25, // 25% damage boost
            upgrades: [
                { cost: 80, buffMultiplier: 1.40 }, // 40% buff
                { cost: 120, buffMultiplier: 1.60 }, // 60% buff
            ],
        },
        tesla: {
            name: 'Tesla Coil',
            description: 'Shoots lightning bolts that chain to up to 3 nearby targets.',
            cost: 150,
            tier: 3,
            unlockWave: 5,
            range: 3,
            damage: 25,
            fireRate: 0.8,
            color: 0xf1c40f,   // bright yellow
            splashRadius: 0,
            chainTargets: 3,   // Hits primary + 2 chains
            upgrades: [
                { cost: 100, damage: 40, chainTargets: 4 },
                { cost: 150, damage: 70, chainTargets: 5 },
            ],
        },
        miner: {
            name: 'Gold Miner',
            description: 'Zero damage. Generates 40 bonus gold at the end of each wave.',
            cost: 180,
            tier: 3,
            unlockWave: 5,
            range: 0,          // Does not shoot
            damage: 0,
            fireRate: 0,
            color: 0x1abc9c,   // turquoise
            splashRadius: 0,
            goldGeneration: 40,
            upgrades: [
                { cost: 120, goldGeneration: 80 },
                { cost: 180, goldGeneration: 140 },
            ],
        },
        doomray: {
            name: 'Doom Ray',
            description: 'Near-global range, massive damage, but extremely slow reload.',
            cost: 300,
            tier: 3,
            unlockWave: 5,
            range: 12,
            damage: 200,
            fireRate: 0.1,     // Fires once every 10 seconds!
            color: 0xe74c3c,   // crimson red
            splashRadius: 0,
            upgrades: [
                { cost: 200, damage: 450, fireRate: 0.12 },
                { cost: 300, damage: 900, fireRate: 0.15 },
            ],
        },
    },

    /* --- Enemy Definitions ---
       WHY three enemy types? Mirrors the "three-pillar" framework from
       our benchmark research:
       - Fast enemies punish players who only build slow, heavy hitters.
       - Armored enemies punish players who only build fast, weak towers.
       - Bosses force players to have a balanced, upgraded defense. */
    enemies: {
        basic: {
            name: 'Scout',
            health: 50,
            speed: 2,           // tiles per second
            reward: 5,          // gold earned on kill
            color: 0xe74c3c,    // red
        },
        fast: {
            name: 'Runner',
            health: 30,
            speed: 4,
            reward: 8,
            color: 0xf39c12,    // orange
        },
        armored: {
            name: 'Tank',
            health: 150,
            speed: 1,
            reward: 15,
            color: 0x9b59b6,    // purple
        },
        boss: {
            name: 'Overlord',
            health: 500,
            speed: 0.8,
            reward: 50,
            color: 0x2c3e50,    // dark navy
        },
    },

    /* --- Wave Definitions ---
       Each wave is an array of { type, count, interval }.
       'interval' is the delay in milliseconds between each spawn.
       
       WHY escalate by ~20% per wave? Our Kingdom Rush benchmark showed
       that linear scaling keeps early waves accessible while still
       ramping up pressure. */
    waves: [
        // Wave 1: Easy intro — just basic scouts
        [{ type: 'basic', count: 5, interval: 1000 }],
        // Wave 2: More scouts
        [{ type: 'basic', count: 8, interval: 900 }],
        // Wave 3: Introduce fast enemies
        [
            { type: 'basic', count: 5, interval: 900 },
            { type: 'fast',  count: 3, interval: 800 },
        ],
        // Wave 4: Mixed pressure
        [
            { type: 'basic', count: 8, interval: 800 },
            { type: 'fast',  count: 5, interval: 700 },
        ],
        // Wave 5: Introduce armored
        [
            { type: 'basic',   count: 6,  interval: 800 },
            { type: 'armored', count: 2,  interval: 1500 },
        ],
        // Wave 6: Heavy mix
        [
            { type: 'fast',    count: 8,  interval: 600 },
            { type: 'armored', count: 3,  interval: 1200 },
        ],
        // Wave 7: Swarm
        [
            { type: 'basic', count: 15, interval: 500 },
            { type: 'fast',  count: 8,  interval: 500 },
        ],
        // Wave 8: Tank rush
        [
            { type: 'armored', count: 6,  interval: 1000 },
            { type: 'fast',    count: 5,  interval: 700 },
        ],
        // Wave 9: Everything
        [
            { type: 'basic',   count: 10, interval: 500 },
            { type: 'fast',    count: 8,  interval: 500 },
            { type: 'armored', count: 4,  interval: 1000 },
        ],
        // Wave 10: Boss wave — the final challenge
        [
            { type: 'armored', count: 3,  interval: 1200 },
            { type: 'boss',    count: 1,  interval: 2000 },
        ],
    ],

    /* --- Map Layout ---
       This 2D array defines the tile grid.
       0 = grass (buildable — players can place towers here)
       1 = path  (enemies walk here — NOT buildable)
       2 = spawn point (where enemies appear)
       3 = exit  (where enemies try to reach — costs a life)
       
       WHY hard-code the map? For the MVP this is the fastest way to
       get a playable level. Later we can load maps from Tiled JSON. */
    mapLayout: [
        // Row 0  (top of screen)
        [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        // Row 1: spawn on left edge
        [2,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        // Row 2
        [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        // Row 3: path turns right
        [0,0,0,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0],
        // Row 4
        [0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0],
        // Row 5: path turns right again
        [0,0,0,0,0,0,0,0,0,1,1,1,1,1,0,0,0,0,0,0],
        // Row 6
        [0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0],
        // Row 7: path goes down
        [0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,0,0,0],
        // Row 8
        [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0],
        // Row 9: path turns left
        [0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,0,0,0],
        // Row 10
        [0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0],
        // Row 11: path goes left
        [0,0,0,0,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0],
        // Row 12
        [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        // Row 13: exit on right edge
        [0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,3],
        // Row 14 (bottom of screen)
        [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ],
};
