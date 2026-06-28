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
        this.waves = GAME_CONFIG.waves;
        this.currentWaveIndex = 0;
        this.totalWaves = this.waves.length;

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
        const waveData = this.waves[this.currentWaveIndex];

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
                    this.enemyManager.spawnEnemy(spawnQueue[i].type);
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

        const waveNumber = this.currentWaveIndex + 1;
        this.currentWaveIndex++;

        return { started: true, waveNumber };
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
