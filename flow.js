(function () {
  const canvas = document.createElement("canvas");
  canvas.className = "flow-field";
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);

  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fieldScale = 280;
  const speed = 26;
  const sampleEvery = 3;
  const historyLength = 24;

  // Divergence-free field from a stream function psi = sum a sin(kx x + ky y + w t + p),
  // so particles circulate instead of piling up in sinks.
  const modes = [
    [1.0, 0.9, 1.3, 0.11, 0.0],
    [0.7, -1.4, 0.8, -0.08, 1.7],
    [0.45, 2.1, -1.6, 0.14, 3.1],
    [0.3, -0.6, -2.4, 0.06, 4.4]
  ];

  let colors = [];
  let width = 0;
  let height = 0;
  let particles = [];
  let frame = 0;
  let running = false;
  let lastTime = 0;
  let clock = 0;
  let tickCount = 0;

  function readPalette() {
    const style = getComputedStyle(document.documentElement);
    colors = [
      style.getPropertyValue("--trace-a").trim() || "#9a3c34",
      style.getPropertyValue("--trace-b").trim() || "#2c428c"
    ];
  }

  function velocity(x, y, t) {
    const u = x / fieldScale;
    const v = y / fieldScale;
    let vx = 0;
    let vy = 0;
    for (let i = 0; i < modes.length; i += 1) {
      const mode = modes[i];
      const c = Math.cos(mode[1] * u + mode[2] * v + mode[3] * t + mode[4]);
      vx += mode[0] * mode[2] * c;
      vy -= mode[0] * mode[1] * c;
    }
    return [vx, vy];
  }

  function spawn(particle) {
    particle.x = Math.random() * width;
    particle.y = Math.random() * height;
    particle.age = 0;
    particle.life = 6 + Math.random() * 8;
    particle.history.length = 0;
    return particle;
  }

  function targetCount() {
    const area = width * height;
    return Math.round(Math.max(90, Math.min(380, area / 4200)));
  }

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const oldWidth = width;
    const oldHeight = height;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    if (oldWidth && oldHeight) {
      particles.forEach(function (particle) {
        particle.x *= width / oldWidth;
        particle.y *= height / oldHeight;
        particle.history.length = 0;
      });
    }

    const count = targetCount();
    while (particles.length < count) {
      const particle = spawn({ history: [], group: particles.length % 2 });
      particle.age = Math.random() * particle.life;
      particles.push(particle);
    }
    particles.length = count;
  }

  function advance(dt) {
    clock += dt;
    tickCount += 1;
    const record = tickCount % sampleEvery === 0;
    particles.forEach(function (particle) {
      const v = velocity(particle.x, particle.y, clock);
      particle.x += v[0] * speed * dt;
      particle.y += v[1] * speed * dt;
      particle.age += dt;
      if (record) {
        particle.history.push(particle.x, particle.y);
        if (particle.history.length > historyLength * 2) {
          particle.history.splice(0, 2);
        }
      }
      const outside = particle.x < -40 || particle.x > width + 40 || particle.y < -40 || particle.y > height + 40;
      if (particle.age > particle.life || outside) {
        spawn(particle);
      }
    });
  }

  function draw() {
    context.clearRect(0, 0, width, height);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 1.1;

    particles.forEach(function (particle) {
      const history = particle.history;
      const points = history.length / 2;
      if (points < 2) {
        return;
      }
      const fade = Math.min(1, particle.age / 1.5, (particle.life - particle.age) / 1.5);
      if (fade <= 0) {
        return;
      }
      context.strokeStyle = colors[particle.group];
      const thirds = Math.max(1, Math.ceil(points / 3));
      for (let part = 0; part < 3; part += 1) {
        const start = part * thirds;
        const end = Math.min(points - 1, start + thirds);
        if (end <= start) {
          continue;
        }
        context.beginPath();
        context.moveTo(history[start * 2], history[start * 2 + 1]);
        for (let i = start + 1; i <= end; i += 1) {
          context.lineTo(history[i * 2], history[i * 2 + 1]);
        }
        if (part === 2) {
          context.lineTo(particle.x, particle.y);
        }
        context.globalAlpha = (0.08 + 0.12 * part) * fade;
        context.stroke();
      }
    });
    context.globalAlpha = 1;
  }

  function tick(timestamp) {
    frame = 0;
    const dt = lastTime ? Math.min(0.05, (timestamp - lastTime) / 1000) : 1 / 60;
    lastTime = timestamp;
    advance(dt);
    draw();
    if (running) {
      frame = window.requestAnimationFrame(tick);
    }
  }

  function start() {
    if (running || reducedMotion) {
      return;
    }
    running = true;
    lastTime = 0;
    frame = window.requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (frame) {
      window.cancelAnimationFrame(frame);
      frame = 0;
    }
  }

  readPalette();
  resize();

  if (reducedMotion) {
    for (let i = 0; i < 90; i += 1) {
      advance(1 / 60);
    }
    draw();
  } else {
    start();
  }

  let resizeTimer = 0;
  window.addEventListener("resize", function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      resize();
      draw();
    }, 120);
  });

  window.addEventListener("themechange", function () {
    readPalette();
    draw();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      stop();
    } else {
      start();
    }
  });
}());
