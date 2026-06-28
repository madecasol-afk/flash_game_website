/* ==========================================================================
   SoundSystem.js — Procedural Audio Synthesizer
   
   WHY procedural audio?
   Instead of loading heavy .mp3 or .wav files, we use the browser's built-in
   Web Audio API to synthesize sound waves (sine, square, sawtooth) on the fly!
   This results in instant load times and perfect retro arcade sound effects.
   ========================================================================== */

class SoundSystem {
    constructor() {
        // Initialize the Web Audio Context
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
    }

    /**
     * Core synthesis function
     * @param {number} startFreq - Starting frequency in Hz
     * @param {number} endFreq - Ending frequency in Hz
     * @param {string} type - Waveform type: 'sine', 'square', 'sawtooth', 'triangle'
     * @param {number} duration - Duration in seconds
     * @param {number} vol - Volume (0.0 to 1.0)
     */
    playTone(startFreq, endFreq, type, duration, vol = 0.1) {
        // Browsers require audio contexts to be resumed after a user gesture
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = type;
        
        // Frequency envelope (pitch slide)
        osc.frequency.setValueAtTime(startFreq, this.ctx.currentTime);
        if (endFreq !== startFreq) {
            osc.frequency.exponentialRampToValueAtTime(endFreq, this.ctx.currentTime + duration);
        }

        // Amplitude envelope (fade out)
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    // --- Specific Sound Effects ---

    playBlaster() {
        // High pitch dropping quickly (classic laser)
        this.playTone(600, 200, 'square', 0.15, 0.05);
    }

    playCannon() {
        // Low pitched rumble
        this.playTone(150, 40, 'sawtooth', 0.4, 0.1);
    }

    playSniper() {
        // Sharp, high-pitched crack
        this.playTone(1200, 400, 'square', 0.1, 0.08);
    }

    playFrost() {
        // Smooth, glassy ping
        this.playTone(800, 800, 'sine', 0.3, 0.05);
    }

    playAcid() {
        // Weird bubbly drop
        this.playTone(300, 100, 'triangle', 0.25, 0.06);
    }

    playLaser() {
        // Very quick buzz
        this.playTone(400, 400, 'sawtooth', 0.08, 0.02);
    }

    playTesla() {
        // Harsh electrical zap
        this.playTone(500, 100, 'sawtooth', 0.1, 0.05);
        setTimeout(() => this.playTone(600, 150, 'sawtooth', 0.1, 0.04), 50);
    }

    playDoomRay() {
        // Massive bass drop
        this.playTone(200, 10, 'sawtooth', 1.0, 0.2);
    }
    
    playBuild() {
        // Happy ascending bloop
        this.playTone(300, 600, 'sine', 0.15, 0.05);
    }

    playSell() {
        // Sad descending bloop
        this.playTone(600, 300, 'triangle', 0.15, 0.05);
    }
}
