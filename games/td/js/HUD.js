/* ==========================================================================
   HUD.js — Heads-Up Display Controller
   
   WHY an HUD class?
   The HUD bridges the game state (gold, lives, wave) and the HTML
   elements on the page. By keeping this in its own class, the game
   scene can simply call hud.setGold(50) without caring about DOM
   manipulation. Clean separation of concerns.
   ========================================================================== */

/**
 * HUD — Reads/writes to the HTML HUD elements and tower shop buttons.
 */
class HUD {
    /**
     * @param {TowerManager} towerManager - So the shop buttons can tell
     *   TowerManager which tower type the player selected.
     */
    constructor(towerManager) {
        this.towerManager = towerManager;

        /* Cache DOM references for performance.
           WHY cache? Calling document.getElementById every frame is slow.
           We look up each element once and reuse the reference. */
        this.goldEl  = document.getElementById('gold-value');
        this.livesEl = document.getElementById('lives-value');
        this.waveEl  = document.getElementById('wave-value');
        this.btnWave = document.getElementById('btn-start-wave');

        /* Tower shop buttons */
        this.towerButtons = document.querySelectorAll('.tower-btn');

        this._setupTowerShop();
    }

    /**
     * _setupTowerShop — Wire up click listeners on each tower button.
     * 
     * When a button is clicked, it toggles the "active" CSS class and
     * tells TowerManager which tower type is selected.
     * 
     * @private
     */
    _setupTowerShop() {
        this.towerButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.tower; // e.g., "basic", "splash"

                /* WHY toggle? If the same button is clicked again, deselect.
                   This lets players cancel a tower placement without needing
                   a separate "cancel" button — intuitive UX. */
                if (btn.classList.contains('active')) {
                    /* Deselect */
                    btn.classList.remove('active');
                    this.towerManager.selectTower(null);
                } else {
                    /* Deselect all others first, then select this one */
                    this.towerButtons.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.towerManager.selectTower(type);
                }
            });
        });
    }

    /**
     * setGold — Update the gold display.
     * @param {number} gold
     */
    setGold(gold) {
        this.goldEl.textContent = gold;
    }

    /**
     * setLives — Update the lives display.
     * @param {number} lives
     */
    setLives(lives) {
        this.livesEl.textContent = lives;
    }

    /**
     * setWave — Update the wave counter display.
     * @param {number} current - Current wave number
     * @param {number} total   - Total number of waves
     */
    setWave(current, total) {
        this.waveEl.textContent = `${current} / ${total}`;
    }

    /**
     * onStartWave — Register a callback for the "Send Wave" button.
     * @param {Function} callback
     */
    onStartWave(callback) {
        this.btnWave.addEventListener('click', callback);
    }

    /**
     * deselectAllTowers — Clear the active state from all tower buttons.
     * Called after a tower is successfully placed.
     */
    deselectAllTowers() {
        this.towerButtons.forEach(b => b.classList.remove('active'));
        this.towerManager.selectTower(null);
    }
}
