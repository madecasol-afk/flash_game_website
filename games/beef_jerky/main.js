const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('scoreDisplay');
const gameOverScreen = document.getElementById('game-over');
const finalScoreEl = document.getElementById('final-score');
const restartBtn = document.getElementById('restart-btn');

// Game state
let isGameOver = false;
let score = 0;
let gameSpeed = 4; 
let frames = 0;
let particles = [];

// Player (Full Flying Cow)
const player = {
    x: 80,
    y: 200,
    size: 35, 
    dy: 0,
    gravity: 0.4,
    flapStrength: -7.5, 
    fartTimer: 0, // Timer for the visual fart effect on the cow itself
    
    draw() {
        ctx.save();
        ctx.translate(this.x + this.size/2, this.y + this.size/2);
        
        let angle = Math.min(Math.PI / 4, Math.max(-Math.PI / 4, (this.dy * 0.1)));
        ctx.rotate(angle);
        ctx.scale(-1, 1);
        
        ctx.font = "35px Arial"; 
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        
        // Visual fart effect: change cow color temporarily when jumping
        if (this.fartTimer > 0) {
            // Sepia + Hue Rotate makes the cow flash a sickly greenish-yellow color!
            ctx.filter = `sepia(0.8) hue-rotate(50deg) saturate(3) brightness(${1 + this.fartTimer * 0.02})`;
            this.fartTimer--;
        } else {
            ctx.filter = 'none';
        }
        
        // Add a white outline so the cow contrasts against the sky
        ctx.lineJoin = "round";
        ctx.lineWidth = 5;
        ctx.strokeStyle = "#ffffff";
        ctx.strokeText("🐄", 0, 0); // Draws the outline
        
        // Draw the actual emoji on top
        ctx.fillText("🐄", 0, 0); 
        
        ctx.restore();
    },
    
    update() {
        this.dy += this.gravity;
        this.y += this.dy;
        
        if (this.y > canvas.height - this.size || this.y < 0) {
            gameOver(); 
        }
        
        this.draw();
    },
    
    flap() {
        this.dy = this.flapStrength;
        this.fartTimer = 15; // Activate the green flash on the cow
        for(let i=0; i<6; i++) {
            particles.push(new FartParticle(this.x, this.y + this.size * 0.6));
        }
    }
};

// Particles for the fart effect
class FartParticle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = -(Math.random() * 3 + 2); 
        this.vy = (Math.random() - 0.5) * 2; 
        this.life = 1.0;
        this.size = Math.random() * 8 + 4; 
    }
    update() {
        this.x += this.vx - gameSpeed; 
        this.y += this.vy;
        this.life -= 0.03; 
        this.size += 0.5; 
        
        const hue = Math.floor(Math.random() * 40) + 70; 
        ctx.fillStyle = `hsla(${hue}, 70%, 40%, ${this.life})`;
        
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
    }
}

// Terrain Blocks (Hills & Caves)
const obstacles = [];
const monsterEmojis = ["👹", "👾", "👽", "🦖", "👿"];

class TerrainBlock {
    constructor() {
        this.width = Math.random() * 30 + 50; 
        this.x = canvas.width;
        
        let gapSize = 250 - (score * 5);
        if (gapSize < 130) gapSize = 130; 
        
        const minHeight = 40; 
        
        this.topHeight = Math.random() * (canvas.height - gapSize - minHeight * 2) + minHeight;
        this.bottomY = this.topHeight + gapSize;
        this.bottomHeight = canvas.height - this.bottomY;
        
        this.passed = false;
        this.emoji = monsterEmojis[Math.floor(Math.random() * monsterEmojis.length)];
    }
    
    draw() {
        // Draw Pastel Cave (Top Blockage)
        ctx.fillStyle = "#E4C5AF"; // Pastel rocky color
        ctx.fillRect(this.x, 0, this.width, this.topHeight);
        
        ctx.fillStyle = "#D6B59D";
        ctx.beginPath();
        ctx.moveTo(this.x, this.topHeight);
        ctx.lineTo(this.x + this.width/2, this.topHeight + 15);
        ctx.lineTo(this.x + this.width, this.topHeight);
        ctx.fill();
        
        // Draw Pastel Hill (Bottom Blockage)
        ctx.fillStyle = "#B5EAD7"; // Pastel grass green
        ctx.fillRect(this.x, this.bottomY, this.width, this.bottomHeight);
        
        ctx.fillStyle = "#A1D9C3";
        ctx.beginPath();
        ctx.moveTo(this.x, this.bottomY);
        ctx.lineTo(this.x + this.width/2, this.bottomY - 15);
        ctx.lineTo(this.x + this.width, this.bottomY);
        ctx.fill();
        
        // Monster sitting on the hill
        ctx.font = "30px Arial"; 
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        // Light shadow for pastel theme
        ctx.shadowColor = "rgba(255, 255, 255, 0.8)";
        ctx.shadowBlur = 8;
        ctx.fillText(this.emoji, this.x + this.width/2, this.bottomY - 2);
        ctx.shadowBlur = 0; 
    }
    
    update() {
        this.x -= gameSpeed;
        this.draw();
    }
}

function handleObstacles() {
    const spawnRate = Math.max(70, 120 - score * 2);
    if (frames % spawnRate === 0) {
        obstacles.push(new TerrainBlock());
    }
    
    for (let i = 0; i < obstacles.length; i++) {
        let obs = obstacles[i];
        obs.update();
        
        const hitboxPadding = 8; 
        
        const hitTop = (
            player.x + hitboxPadding < obs.x + obs.width &&
            player.x + player.size - hitboxPadding > obs.x &&
            player.y + hitboxPadding < obs.topHeight
        );
        
        const hitBottom = (
            player.x + hitboxPadding < obs.x + obs.width &&
            player.x + player.size - hitboxPadding > obs.x &&
            player.y + player.size - hitboxPadding > obs.bottomY - 10 
        );
        
        if (hitTop || hitBottom) {
            gameOver();
        }
        
        if (obs.x + obs.width < player.x && !obs.passed) {
            score++;
            scoreEl.innerText = 'Score: ' + score;
            obs.passed = true;
            
            if (score % 8 === 0) {
                gameSpeed += 0.3;
            }
        }
        
        if (obs.x + obs.width < -50) {
            obstacles.splice(i, 1);
            i--;
        }
    }
}

function handleParticles() {
    for (let i = 0; i < particles.length; i++) {
        particles[i].update();
        if (particles[i].life <= 0) {
            particles.splice(i, 1);
            i--;
        }
    }
}

function init() {
    isGameOver = false;
    score = 0;
    gameSpeed = 4; 
    frames = 0;
    obstacles.length = 0;
    particles.length = 0;
    player.y = canvas.height / 2;
    player.dy = 0;
    player.fartTimer = 0;
    scoreEl.innerText = 'Score: 0';
    gameOverScreen.classList.add('hidden');
    animate();
}

function gameOver() {
    if (isGameOver) return; 
    isGameOver = true;
    finalScoreEl.innerText = score;
    gameOverScreen.classList.remove('hidden');
    
    ctx.font = "60px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("💥", player.x + player.size/2, player.y + player.size/2);
}

function drawBackground() {
    // Pastel scrolling lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 1;
    
    let offset = (frames * (gameSpeed/2)) % 40;
    for (let i = 0; i < canvas.width; i += 40) {
        ctx.beginPath();
        ctx.moveTo(i - offset, 0);
        ctx.lineTo(i - offset, canvas.height);
        ctx.stroke();
    }
    
    // Solid Pastel Grass Floor at the absolute bottom
    ctx.fillStyle = "#B5EAD7";
    ctx.fillRect(0, canvas.height - 10, canvas.width, 10);
}

function animate() {
    if (isGameOver) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    drawBackground();
    handleParticles();
    player.update();
    handleObstacles();
    
    frames++;
    requestAnimationFrame(animate);
}

// Controls
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp') {
        if (e.code === 'Space') e.preventDefault();
        if (!isGameOver) player.flap();
    }
});

window.addEventListener('mousedown', () => {
    if (!isGameOver) player.flap();
});

restartBtn.addEventListener('click', init);

init();
