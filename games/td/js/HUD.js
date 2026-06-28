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
        
        // Cache the tower inspector container
        this.inspectorEl = document.getElementById('tower-inspector');

        /* Tower shop buttons */
        this.towerButtons = document.querySelectorAll('.tower-btn');

        this._setupTowerShop();
    }

    /**
     * _setupTowerShop — Wire up click and hover listeners on each tower button.
     * 
     * When a button is clicked, it toggles the "active" CSS class and
     * tells TowerManager which tower type is selected. Hovering updates
     * the Inspector Pane details.
     * 
     * @private
     */
    _setupTowerShop() {
        this.towerButtons.forEach(btn => {
            const type = btn.dataset.tower; // e.g., "basic", "splash", "sell", "move"

            // Click Handler
            btn.addEventListener('click', () => {
                // If the tower is locked because player has not reached the required wave, block click.
                if (btn.classList.contains('locked')) {
                    return;
                }

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

            // Hover Enter Handler — show description and stats in inspector
            btn.addEventListener('mouseenter', () => {
                this.showInspectorDetails(type);
            });

            // Hover Leave Handler — restore inspector to current selection or clear it
            btn.addEventListener('mouseleave', () => {
                const activeBtn = Array.from(this.towerButtons).find(b => b.classList.contains('active'));
                if (activeBtn) {
                    this.showInspectorDetails(activeBtn.dataset.tower);
                } else {
                    this.showInspectorDetails(null);
                }
            });
        });
    }

    /**
     * showInspectorDetails — Populates the inspector pane with tower descriptions and stats.
     * 
     * Purpose:
     * Reads metadata and configurations for the hovered item and displays them in HTML.
     * For towers, it also draws a stats row showing Damage, Range, and Fire Rate.
     *
     * @param {string|null} type - The tower type key or tool action name
     */
    showInspectorDetails(type) {
        const titleEl = this.inspectorEl.querySelector('.inspector-title');
        const descEl = this.inspectorEl.querySelector('.inspector-desc');
        
        // Remove existing stats container if it is on screen
        const existingStats = this.inspectorEl.querySelector('.inspector-stats');
        if (existingStats) {
            existingStats.remove();
        }

        // If no hover, show default text
        if (!type) {
            titleEl.textContent = 'Hover a tower to inspect';
            descEl.textContent = 'See descriptions, range, and stats here.';
            return;
        }

        // Tool Cases
        if (type === 'sell') {
            titleEl.textContent = '💰 Sell Mode';
            descEl.textContent = 'Click on an existing tower to sell it and recover 70% of its total cost (upgrades included).';
            return;
        }

        if (type === 'move') {
            titleEl.textContent = '🤚 Move Mode';
            descEl.textContent = 'Click a tower to pick it up, then click an empty tile to drop it. Free to use between waves!';
            return;
        }

        // Tower configuration case
        const def = GAME_CONFIG.towers[type];
        if (!def) return;

        titleEl.textContent = `${def.name} (Tier ${def.tier})`;
        descEl.textContent = def.description;

        // Display current wave lock warning if applicable
        const currentWave = parseInt(this.waveEl.textContent.split('/')[0].trim());
        if (currentWave < def.unlockWave) {
            descEl.textContent += ` [LOCKED: Unlocks at Wave ${def.unlockWave}]`;
        }

        // Draw Stats row
        const statsEl = document.createElement('div');
        statsEl.className = 'inspector-stats';
        
        const dmgText = def.damage > 0 ? `${def.damage}` : 'N/A';
        const rangeText = `${def.range} tiles`;
        const speedText = def.fireRate > 0 ? `${def.fireRate}/s` : 'N/A';

        statsEl.innerHTML = `
            <span>⚔️ Dmg: ${dmgText}</span>
            <span>🎯 Rng: ${rangeText}</span>
            <span>⚡ Spd: ${speedText}</span>
        `;
        this.inspectorEl.appendChild(statsEl);
    }

    /**
     * updateUnlockStates — Check each tower's unlock criteria and enable/disable shop buttons.
     * 
     * Purpose:
     * This method runs at the start of a wave or level check. It reads the current wave number,
     * compares it to each tower's `unlockWave` definition, and adds/removes the CSS `locked` class
     * and HTML `disabled` property.
     *
     * @param {number} waveNumber - The current wave the player is on
     */
    updateUnlockStates(waveNumber) {
        this.towerButtons.forEach(btn => {
            const type = btn.dataset.tower;
            const def = GAME_CONFIG.towers[type];
            
            // Tools never lock
            if (!def) return;

            if (waveNumber >= def.unlockWave) {
                btn.classList.remove('locked');
                btn.removeAttribute('disabled');
                
                // If it was locked, we remove the unlock label from the HTML
                const label = btn.querySelector('.unlock-label');
                if (label) label.remove();
            } else {
                btn.classList.add('locked');
                btn.setAttribute('disabled', 'true');
            }
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
