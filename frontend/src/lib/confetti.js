const COLORS = ["#FFD700", "#FF3366", "#00FFA3", "#9945FF", "#FFEA66", "#FF668C"];

export function launchConfetti(canvasEl, duration = 3500) {
  if (!canvasEl) return;
  const ctx = canvasEl.getContext("2d");
  canvasEl.width = window.innerWidth;
  canvasEl.height = window.innerHeight;
  const W = canvasEl.width;
  const H = canvasEl.height;

  const particles = Array.from({ length: 130 }, () => ({
    x: W * 0.2 + Math.random() * W * 0.6,
    y: H * 0.1 + Math.random() * H * 0.2,
    vx: (Math.random() - 0.5) * 8,
    vy: -(Math.random() * 6 + 2),
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    w: Math.random() * 10 + 4,
    h: Math.random() * 5 + 2,
    angle: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 0.25,
    life: 1.0,
    decay: Math.random() * 0.006 + 0.004,
  }));

  const start = Date.now();
  let raf;

  const loop = () => {
    ctx.clearRect(0, 0, W, H);
    let alive = false;
    for (const p of particles) {
      p.x += p.vx;
      p.vy += 0.18;
      p.y += p.vy;
      p.angle += p.spin;
      p.life -= p.decay;
      if (p.life <= 0) continue;
      alive = true;
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (alive && Date.now() - start < duration) {
      raf = requestAnimationFrame(loop);
    } else {
      ctx.clearRect(0, 0, W, H);
    }
  };

  raf = requestAnimationFrame(loop);
  return () => { cancelAnimationFrame(raf); ctx.clearRect(0, 0, W, H); };
}
