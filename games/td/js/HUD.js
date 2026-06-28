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
     * @param {Phaser.Scene} scene       - The active Phaser scene
     * @param {TowerManager} towerManager - So the shop buttons can tell
     *   TowerManager which tower type the player selected.
     */
    constructor(scene, towerManager) {
        this.scene = scene;
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

        /* Mass Upgrade */
        this.massUpgradeSelect = document.getElementById('mass-upgrade-class');
        this.massDmgBtn = document.getElementById('mass-upgrade-dmg-btn');
        this.massSpdBtn = document.getElementById('mass-upgrade-spd-btn');
        this.massRngBtn = document.getElementById('mass-upgrade-rng-btn');

        this._setupTowerShop();
        this._setupMassUpgrade();
    }

    _setupMassUpgrade() {
        this.massUpgradeSelect.addEventListener('change', () => this.updateMassUpgradeButton());
        
        this.massDmgBtn.addEventListener('click', () => {
            this.scene.events.emit('mass-upgrade', this.massUpgradeSelect.value, 'damage');
        });
        this.massSpdBtn.addEventListener('click', () => {
            this.scene.events.emit('mass-upgrade', this.massUpgradeSelect.value, 'speed');
        });
        this.massRngBtn.addEventListener('click', () => {
            this.scene.events.emit('mass-upgrade', this.massUpgradeSelect.value, 'range');
        });
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
        this.updateMassUpgradeButton();
    }

    /**
     * updateMassUpgradeButton — Calculates the total cost to upgrade all towers of the selected type.
     */
    updateMassUpgradeButton() {
        const towerClass = this.massUpgradeSelect.value;
        const def = GAME_CONFIG.towers[towerClass];
        if (!def) return;
        
        let dmgCost = 0;
        let spdCost = 0;
        let rngCost = 0;
        let count = 0;
        
        for (const tower of this.towerManager.towers) {
            if (tower.type === towerClass) {
                dmgCost += Math.round(def.cost * Math.pow(1.15, tower.damageLevel));
                spdCost += Math.round((def.cost * 1.5) * Math.pow(1.15, tower.speedLevel));
                rngCost += Math.round((def.cost * 0.8) * Math.pow(1.15, tower.rangeLevel));
                count++;
            }
        }
        
        const currentGold = parseInt(this.goldEl.textContent) || 0;
        
        const updateBtn = (btn, cost, icon, isValid) => {
            if (count === 0 || !isValid) {
                btn.textContent = `${icon} -`;
                btn.disabled = true;
                btn.style.backgroundColor = '#2a2a2a';
                btn.style.color = '#777';
            } else {
                btn.textContent = `${icon} ${cost}g`;
                if (currentGold >= cost) {
                    btn.disabled = false;
                    btn.style.backgroundColor = '#27ae60';
                    btn.style.color = '#fff';
                } else {
                    btn.disabled = true;
                    btn.style.backgroundColor = '#2a2a2a';
                    btn.style.color = '#777';
                }
            }
        };

        updateBtn(this.massDmgBtn, dmgCost, '⚔️', true);
        updateBtn(this.massSpdBtn, spdCost, '⚡', def.fireRate > 0);
        updateBtn(this.massRngBtn, rngCost, '🎯', def.range > 0);
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

    /**
     * showInspectedTowerDetails — Populates the inspector with a placed tower's current upgrade path.
     * 
     * Purpose:
     * This method renders stats for a placed tower, shows its next upgrade cost/details, and creates
     * interactive Upgrade and Sell buttons. Clicking these buttons emits events back to the Phaser scene.
     *
     * @param {object} tower - The tower object being inspected
     */
    showInspectedTowerDetails(tower) {
        const titleEl = this.inspectorEl.querySelector('.inspector-title');
        const descEl = this.inspectorEl.querySelector('.inspector-desc');
        
        const existingStats = this.inspectorEl.querySelector('.inspector-stats');
        if (existingStats) existingStats.remove();
        
        const existingActions = this.inspectorEl.querySelector('.inspector-actions');
        if (existingActions) existingActions.remove();

        const def = GAME_CONFIG.towers[tower.type];
        if (!def) return;

        // Calculate max level among all stats to show a unified "Level" in the title
        const maxLevel = Math.max(tower.damageLevel, tower.speedLevel, tower.rangeLevel);
        titleEl.textContent = `${def.name} (Lv. ${maxLevel + 1})`;
        
        descEl.textContent = 'Upgrade individual stats to scale indefinitely.';

        // Current Stats Row
        const statsEl = document.createElement('div');
        statsEl.className = 'inspector-stats';
        
        let dmgText = tower.damage > 0 ? `${Math.round(tower.damage)}` : 'N/A';
        // Handle special stats for non-damage towers
        if (def.goldGeneration) dmgText = `+${Math.round(tower.goldGeneration)}g`;
        else if (def.buffMultiplier) dmgText = `x${tower.buffMultiplier.toFixed(2)}`;
        else if (def.slowMultiplier) dmgText = `x${tower.slowMultiplier.toFixed(2)} spd`;
        
        const rangeText = `${tower.range.toFixed(1)} tiles`;
        const speedText = tower.fireRate > 0 ? `${tower.fireRate.toFixed(1)}/s` : 'N/A';

        statsEl.innerHTML = `
            <span>⚔️ Pwr: ${dmgText}</span>
            <span>🎯 Rng: ${rangeText}</span>
            <span>⚡ Spd: ${speedText}</span>
        `;
        this.inspectorEl.appendChild(statsEl);

        const actionsEl = document.createElement('div');
        actionsEl.className = 'inspector-actions';
        actionsEl.style.display = 'flex';
        actionsEl.style.flexDirection = 'column';
        actionsEl.style.gap = '5px';

        const currentGold = parseInt(this.goldEl.textContent);

        // 1. Damage / Power Upgrade Button
        const dmgCost = Math.round(def.cost * Math.pow(1.15, tower.damageLevel));
        const dmgBtn = document.createElement('button');
        dmgBtn.className = 'inspector-btn';
        dmgBtn.textContent = `⚔️ Pwr Up (${dmgCost}g)`;
        if (currentGold < dmgCost) dmgBtn.disabled = true;
        dmgBtn.addEventListener('click', () => this.scene.events.emit('upgrade-tower', tower, 'damage', dmgCost));
        actionsEl.appendChild(dmgBtn);

        // 2. Speed Upgrade Button (Only for towers that shoot)
        if (tower.fireRate > 0) {
            const spdCost = Math.round((def.cost * 1.5) * Math.pow(1.15, tower.speedLevel));
            const spdBtn = document.createElement('button');
            spdBtn.className = 'inspector-btn';
            spdBtn.textContent = `⚡ Spd Up (${spdCost}g)`;
            if (currentGold < spdCost) spdBtn.disabled = true;
            // Cap at 15 shots/sec to prevent physics engine lag
            if (tower.fireRate >= 15) {
                spdBtn.textContent = '⚡ Spd MAX';
                spdBtn.disabled = true;
            }
            spdBtn.addEventListener('click', () => this.scene.events.emit('upgrade-tower', tower, 'speed', spdCost));
            actionsEl.appendChild(spdBtn);
        }

        // 3. Range Upgrade Button (Not for miner)
        if (def.range > 0) {
            const rngCost = Math.round((def.cost * 0.8) * Math.pow(1.15, tower.rangeLevel));
            const rngBtn = document.createElement('button');
            rngBtn.className = 'inspector-btn';
            rngBtn.textContent = `🎯 Rng Up (${rngCost}g)`;
            if (currentGold < rngCost) rngBtn.disabled = true;
            rngBtn.addEventListener('click', () => this.scene.events.emit('upgrade-tower', tower, 'range', rngCost));
            actionsEl.appendChild(rngBtn);
        }

        // 4. Sell Button
        const sellBtn = document.createElement('button');
        sellBtn.className = 'inspector-btn inspector-btn--sell';
        sellBtn.style.marginTop = '10px';
        
        const totalCost = def.cost + tower.damageSpent + tower.speedSpent + tower.rangeSpent;
        const refundAmount = Math.round(totalCost * 0.7);
        sellBtn.textContent = `💰 Sell (+${refundAmount}g)`;
        sellBtn.addEventListener('click', () => this.scene.events.emit('sell-tower', tower));
        actionsEl.appendChild(sellBtn);

        this.inspectorEl.appendChild(actionsEl);
    }
}
