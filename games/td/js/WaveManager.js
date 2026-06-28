/* ==========================================================================
   WaveManager.js — Manages Enemy Wave Spawning
   
   WHY a WaveManager?
   Waves are the "pacing engine" of a tower defense game. They control
   WHEN and WHAT enemies appear. By isolating this in its own class,
   we can easily tweak wave composition in config.js without touching
   any movement or combat code.
   ========================================================================== */

/**
 * WaveManager — Reads wave definitions from GAME_CONFIG.waves and
 * spawns enemies through EnemyManager at timed intervals.
 */
class WaveManager {
    /**
     * @param {EnemyManager} enemyManager - Reference to spawn enemies through
     */
    constructor(enemyManager) {
        this.enemyManager = enemyManager;
        this.currentWaveIndex = 0;
        this.totalWaves = 100; // Expanded from 10 to 100 waves!

        /* WHY track waveActive?
           Prevents the player from accidentally starting two waves at once
           by double-clicking the "Send Wave" button. */
        this.waveActive = false;

        /* Array of pending spawn timers so we can cancel them on game reset */
        this.spawnTimers = [];
    }

    /**
     * startNextWave — Begin spawning the next wave of enemies.
     * 
     * @param {Phaser.Scene} scene - Needed for Phaser's time.addEvent
     * @returns {{ started: boolean, waveNumber: number }}
     */
    startNextWave(scene) {
        /* Don't start if a wave is already in progress */
        if (this.waveActive) {
            return { started: false, waveNumber: this.currentWaveIndex };
        }

        /* Don't start if we've already finished all waves */
        if (this.currentWaveIndex >= this.totalWaves) {
            return { started: false, waveNumber: this.currentWaveIndex };
        }

        this.waveActive = true;
        const waveNumber = this.currentWaveIndex + 1;

        // Procedurally generate the composition of the wave.
        // WHY? Hardcoding 100 waves takes tons of code. Procedural generation gives us smooth scaling.
        const waveData = this.generateWaveData(waveNumber);

        /* WHY flatten the wave groups into a single spawn queue?
           Each wave can have multiple enemy groups (e.g., 5 scouts + 3 runners).
           We merge them into one sequential queue so the spawning logic
           is simple: pop from the queue at the specified interval. */
        const spawnQueue = [];
        for (const group of waveData) {
            for (let i = 0; i < group.count; i++) {
                spawnQueue.push({
                    type: group.type,
                    interval: group.interval,
                });
            }
        }

        /* Schedule each enemy spawn using Phaser's timer system */
        let cumulativeDelay = 0;
        for (let i = 0; i < spawnQueue.length; i++) {
            cumulativeDelay += spawnQueue[i].interval;

            const timer = scene.time.addEvent({
                delay: cumulativeDelay,
                callback: () => {
                    // Pass waveNumber to scale enemy stats (health)
                    this.enemyManager.spawnEnemy(spawnQueue[i].type, waveNumber);
                },
                callbackScope: this,
            });
            this.spawnTimers.push(timer);
        }

        /* Schedule the "wave complete" check after all spawns + a buffer.
           WHY a buffer? The last enemy needs time to either die or reach
           the exit. We check periodically until no active enemies remain. */
        const checkTimer = scene.time.addEvent({
            delay: cumulativeDelay + 2000,
            callback: () => this._checkWaveComplete(scene),
            callbackScope: this,
            loop: true,
        });
        this.spawnTimers.push(checkTimer);

        this.currentWaveIndex++;

        return { started: true, waveNumber };
    }

    /**
     * generateWaveData — Dynamically designs a wave's composition based on the wave number (1 to 100).
     * 
     * Purpose:
     * We calculate a difficulty budget (pointsBudget) and spend it on different
     * enemy types according to their unlock waves and costs.
     *
     * @param {number} waveNumber - Current wave index (1-indexed: 1 to 100)
     * @returns {object[]} Array of enemy spawn groups (e.g. [{ type: 'basic', count: 10, interval: 600 }])
     */
    generateWaveData(waveNumber) {
        // Step 1: Calculate the difficulty points budget for this wave.
        // We use a quadratic formula: difficulty rises slowly at first, then scales steeper.
        // - Wave 1: 30 points
        // - Wave 10: 170 points
        // - Wave 50: 1770 points
        // - Wave 100: 6020 points
        const pointsBudget = 20 + (waveNumber * 10) + Math.round(Math.pow(waveNumber, 1.8) * 0.5);

        // Step 2: Define enemy costs (points needed to spawn 1 unit) and unlock wave conditions
        const enemyDefs = [
            { type: 'basic', cost: 5, minWave: 1 },
            { type: 'fast', cost: 10, minWave: 3 },
            { type: 'armored', cost: 25, minWave: 7 },
            { type: 'boss', cost: 150, minWave: 15 }
        ];

        const waveData = [];

        // Check if this is a major Boss Milestone wave (every 10 waves)
        // WHY? Milestone waves provide exciting spikes in challenge and visual pacing.
        const isMilestone = (waveNumber % 10 === 0);

        if (isMilestone) {
            // Milestone Wave: Spend the budget primarily on Bosses and Armored units
            let remaining = pointsBudget;
            
            // Calculate how many Bosses we can afford (at least 1 if wave >= 15)
            if (waveNumber >= 15) {
                const bossCount = Math.max(1, Math.floor((remaining * 0.5) / 150));
                waveData.push({ type: 'boss', count: bossCount, interval: 3500 }); // slow spawn pace for bosses
                remaining -= bossCount * 150;
            }

            // Spend the rest on Armored giants
            if (waveNumber >= 7) {
                const armoredCount = Math.floor(remaining / 25);
                if (armoredCount > 0) {
                    waveData.push({ type: 'armored', count: armoredCount, interval: 1200 });
                    remaining -= armoredCount * 25;
                }
            }

            // Spend any leftover change on Fast runners to swarm the player
            const fastCount = Math.floor(remaining / 10);
            if (fastCount > 0) {
                waveData.push({ type: 'fast', count: fastCount, interval: 400 });
            }
        } else {
            // Regular Wave: Select all enemy types currently unlocked
            const availableEnemies = enemyDefs.filter(e => waveNumber >= e.minWave);
            
            // Spend the budget dynamically: we assign portion budgets to different available categories
            let remaining = pointsBudget;

            // Pick a primary enemy type (the strongest one available, takes 40% of the budget)
            const primaryEnemy = availableEnemies[availableEnemies.length - 1];
            const primaryCount = Math.floor((remaining * 0.4) / primaryEnemy.cost);
            if (primaryCount > 0) {
                // Determine spawn interval based on type (bosses spawn slower, runners spawn faster)
                let interval = 800;
                if (primaryEnemy.type === 'boss') interval = 4000;
                else if (primaryEnemy.type === 'armored') interval = 1500;
                else if (primaryEnemy.type === 'fast') interval = 500;
                
                waveData.push({ type: primaryEnemy.type, count: primaryCount, interval });
                remaining -= primaryCount * primaryEnemy.cost;
            }

            // Spend 60% of remaining budget on a secondary type
            if (availableEnemies.length > 1) {
                const secondaryEnemy = availableEnemies[availableEnemies.length - 2];
                const secondaryCount = Math.floor((remaining * 0.6) / secondaryEnemy.cost);
                if (secondaryCount > 0) {
                    let interval = 600;
                    if (secondaryEnemy.type === 'armored') interval = 1200;
                    else if (secondaryEnemy.type === 'fast') interval = 400;
                    
                    waveData.push({ type: secondaryEnemy.type, count: secondaryCount, interval });
                    remaining -= secondaryCount * secondaryEnemy.cost;
                }
            }

            // Fill the remaining budget with the standard basic units
            const basicCount = Math.floor(remaining / 5);
            if (basicCount > 0) {
                waveData.push({ type: 'basic', count: basicCount, interval: 400 });
            }
        }

        return waveData;
    }

    /**
     * _checkWaveComplete — Periodically checks if all enemies from the
     * current wave are dead or have exited. When true, marks the wave
     * as complete so the player can start the next one.
     * 
     * @param {Phaser.Scene} scene
     * @private
     */
    _checkWaveComplete(scene) {
        const activeEnemies = this.enemyManager.getActiveEnemies();
        if (activeEnemies.length === 0) {
            this.waveActive = false;
            
            // Emit a wave complete event so the game scene knows the wave is over.
            // WHY? This tells TDScene to trigger end-of-wave payouts (like Gold Miner generation).
            scene.events.emit('wave-complete');

            /* Remove the repeating check timer */
            this.spawnTimers.forEach(t => {
                if (t.loop) t.remove();
            });
        }
    }

    /**
     * isAllWavesDone — Have all waves been sent AND are no enemies left?
     * 
     * @returns {boolean}
     */
    isAllWavesDone() {
        return (
            this.currentWaveIndex >= this.totalWaves &&
            !this.waveActive &&
            this.enemyManager.getActiveEnemies().length === 0
        );
    }

    /**
     * reset — Clear all timers and reset to wave 1.
     * Used when the player restarts the game.
     */
    reset() {
        this.spawnTimers.forEach(t => t.remove());
        this.spawnTimers = [];
        this.currentWaveIndex = 0;
        this.waveActive = false;
    }
}
