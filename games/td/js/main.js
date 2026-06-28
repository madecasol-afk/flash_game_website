/* ==========================================================================
   main.js — Phaser Game Bootstrap
   
   WHY a separate main.js?
   This file's ONLY job is to create the Phaser.Game instance with the
   right configuration and attach it to the DOM. All game logic lives
   in TDScene.js and the manager classes.
   
   Think of this as the "ignition key" that starts the engine.
   ========================================================================== */

/**
 * Phaser Game Configuration
 * 
 * Key settings explained:
 * - type: Phaser.AUTO → use WebGL if available, fall back to Canvas 2D
 * - parent: 'game-container' → injects the <canvas> into our styled div
 * - width/height: match our grid dimensions (20×40=800, 15×40=600)
 * - backgroundColor: matches our dark theme so there's no white flash
 * - scene: [TDScene] → register our main game scene
 */
const phaserConfig = {
    type: Phaser.AUTO,
    parent: 'game-container',
    width: GAME_CONFIG.canvasWidth,
    height: GAME_CONFIG.canvasHeight,
    backgroundColor: '#1a1a2e',
    /* WHY disable antiAlias for pixel art? We're using geometric shapes
       (not pixel art) for the MVP, so we keep it on for smooth edges. */
    render: {
        antialias: true,
        pixelArt: false,
    },
    scene: [TDScene],
};

/* Create the game — this starts the Phaser lifecycle:
   1. Phaser creates a <canvas> inside #game-container
   2. It calls TDScene.preload() to load assets
   3. It calls TDScene.create() to set up the game world
   4. It starts calling TDScene.update() ~60 times per second */
const game = new Phaser.Game(phaserConfig);

console.log('🕹️ Arcade Forge — Phaser game instance created');
