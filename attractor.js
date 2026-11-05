(function () {
  const data = window.ATTRACTORS;
  const canvas = document.getElementById("flow");
  if (!data || !data.systems || !data.systems.length || !canvas) {
    return;
  }

  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const root = document.documentElement;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const cycleMs = 16000;
  const driftPerMs = reducedMotion ? 0 : 0.00006;
  const maxPitch = 0.5;
  const cameraDistance = 3.6;
  let colors = [];
  let paper = "";

  function readPalette() {
    const style = getComputedStyle(root);
    colors = [
      style.getPropertyValue("--trace-a").trim() || "#9a3c34",
      style.getPropertyValue("--trace-b").trim() || "#2c428c"
    ];
    paper = style.getPropertyValue("--paper").trim() || "#f3f0e8";
  }

  readPalette();

  function decode(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const ints = new Int16Array(bytes.buffer);
    const values = new Float32Array(ints.length);
    for (let i = 0; i < ints.length; i += 1) {
      values[i] = ints[i] / 32767;
    }
    return values;
  }

  const systems = data.systems.map(function (system) {
    return {
      name: system.name,
      label: system.label,
      coords: decode(system.data)
    };
  });
  const pointCount = data.points;
  const stride = pointCount * 3;
  // Trail lengths were tuned for 260 samples per trajectory.
  const pointDensity = pointCount / 260;
  const depthSpan = 2;

  const paths = [];
  for (let index = 0; index < data.count; index += 1) {
    paths.push({
      index: index,
      count: pointCount,
      world: new Float32Array(stride),
      screen: new Float32Array(pointCount * 2),
      group: data.groups[index] || 0,
      weight: data.widths[index],
      depth: 0
    });
  }

  /* Morphing between systems */

  const holdMs = 4000;
  const morphMs = 3000;
  // Fraction of the morph over which the wave sweeps from top to bottom.
  const waveSpread = 0.45;
  const morph = {
    from: new Float32Array(systems[0].coords),
    to: systems[0].coords,
    t: 1,
    target: 0
  };
  let holdLeft = holdMs;

  // Camera yaw (radians) a system should be seen at halfway through its hold.
  // The camera swings there during the morph; systems not listed keep the free drift.
  const preferredYaw = { NoseHoover: 1.81 };
  let yawSwing = 0;

  function wrapAngle(angle) {
    return angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI));
  }

  function ease(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function mixWorld() {
    const t = Math.min(1, morph.t);
    const from = morph.from;
    const to = morph.to;
    paths.forEach(function (path) {
      const offset = path.index * stride;
      const world = path.world;
      for (let i = 0; i < pointCount; i += 1) {
        const k = offset + i * 3;
        const wave = Math.min(1, Math.max(0, (1 - (from[k + 1] + to[k + 1]) / 2) / 2));
        const local = Math.min(1, Math.max(0, (t - waveSpread * wave) / (1 - waveSpread)));
        const mix = ease(local);
        for (let j = 0; j < 3; j += 1) {
          const a = from[k + j];
          world[i * 3 + j] = a + (to[k + j] - a) * mix;
        }
      }
    });
  }

  function goTo(target) {
    if (target === morph.target) {
      return;
    }
    paths.forEach(function (path) {
      morph.from.set(path.world, path.index * stride);
    });
    morph.to = systems[target].coords;
    morph.target = target;
    morph.t = reducedMotion ? 1 : 0;
    holdLeft = holdMs;
    yawSwing = 0;
    const wanted = preferredYaw[systems[target].name];
    if (wanted !== undefined) {
      const drift = driftPerMs * (morphMs + holdMs / 2);
      yawSwing = wrapAngle(wanted - (view.yaw + drift));
      if (reducedMotion) {
        view.yaw += yawSwing;
        yawSwing = 0;
      }
    }
    mixWorld();
    canvas.setAttribute("aria-label", "Animated trajectories of the " + systems[target].label + " attractor, a chaotic dynamical system.");
    window.dispatchEvent(new CustomEvent("attractorchange", { detail: { index: target } }));
    wake();
  }

  mixWorld();

  /* Camera and drawing */

  let width = 0;
  let height = 0;
  let scale = 1;
  let frame = 0;
  let running = false;
  let lastTime = 0;

  const view = {
    yaw: 0,
    pitch: 0,
    tiltYaw: 0,
    tiltPitch: 0,
    targetTiltYaw: 0,
    targetTiltPitch: 0,
    velocity: 0
  };
  const camera = { cy: 1, sy: 0, cp: 1, sp: 0 };
  const drag = { active: false, id: null, x: 0, y: 0, time: 0 };

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    scale = Math.min(width, height) * 0.39;
  }

  function updateCamera() {
    const yaw = view.yaw + view.tiltYaw;
    const pitch = view.pitch + view.tiltPitch;
    camera.cy = Math.cos(yaw);
    camera.sy = Math.sin(yaw);
    camera.cp = Math.cos(pitch);
    camera.sp = Math.sin(pitch);
  }

  // Writes screen x, screen y and view depth (positive is towards the viewer) into out.
  function projectPoint(x, y, z, out) {
    const x1 = camera.cy * x + camera.sy * z;
    const z1 = -camera.sy * x + camera.cy * z;
    const y2 = camera.cp * y - camera.sp * z1;
    const z2 = camera.sp * y + camera.cp * z1;
    const perspective = cameraDistance / (cameraDistance - z2);
    out[0] = width / 2 + x1 * scale * perspective;
    out[1] = height / 2 - y2 * scale * perspective;
    out[2] = z2;
  }

  const projected = new Float64Array(3);

  function project() {
    updateCamera();
    paths.forEach(function (path) {
      const world = path.world;
      const screen = path.screen;
      let depthTotal = 0;
      for (let i = 0; i < path.count; i += 1) {
        projectPoint(world[i * 3], world[i * 3 + 1], world[i * 3 + 2], projected);
        screen[i * 2] = projected[0];
        screen[i * 2 + 1] = projected[1];
        depthTotal += projected[2];
      }
      path.depth = Math.min(1, Math.max(0, depthTotal / path.count / depthSpan + 0.5));
    });

    paths.sort(function (a, b) {
      return a.depth - b.depth;
    });
  }

  function strokePath(screen, start, end, color, alpha, lineWidth) {
    if (end - start < 1) {
      return;
    }
    // Quadratic segments through the midpoints, using each sample as the control point.
    context.beginPath();
    context.moveTo(screen[start * 2], screen[start * 2 + 1]);
    for (let index = start + 1; index < end; index += 1) {
      const x = screen[index * 2];
      const y = screen[index * 2 + 1];
      context.quadraticCurveTo(x, y, (x + screen[index * 2 + 2]) / 2, (y + screen[index * 2 + 3]) / 2);
    }
    context.lineTo(screen[end * 2], screen[end * 2 + 1]);
    context.strokeStyle = color;
    context.globalAlpha = alpha;
    context.lineWidth = lineWidth;
    context.stroke();
  }

  function draw(timestamp) {
    project();
    context.clearRect(0, 0, width, height);
    context.lineCap = "round";
    context.lineJoin = "round";

    const progress = reducedMotion ? 0.62 : (timestamp % cycleMs) / cycleMs;
    const spans = [
      [Math.round(52 * pointDensity), 0.2, 1.15],
      [Math.round(24 * pointDensity), 0.45, 1.45],
      [Math.round(9 * pointDensity), 0.9, 1.85]
    ];

    paths.forEach(function (path) {
      const screen = path.screen;
      const last = path.count - 1;
      const depthWidth = 0.6 + 0.8 * path.depth;
      const weight = path.weight * depthWidth;
      const color = colors[path.group] || colors[0];

      strokePath(screen, 0, last, color, 0.12 + 0.2 * path.depth, 0.85 * weight);

      const head = progress * last;
      const fadePoints = 16 * pointDensity;
      const edge = Math.min(1, head / fadePoints, (last - head) / fadePoints) * (0.45 + 0.55 * path.depth);
      const tipIndex = Math.floor(head);
      const nextIndex = Math.min(last, tipIndex + 1);
      const fraction = head - tipIndex;
      const tipX = screen[tipIndex * 2] + (screen[nextIndex * 2] - screen[tipIndex * 2]) * fraction;
      const tipY = screen[tipIndex * 2 + 1] + (screen[nextIndex * 2 + 1] - screen[tipIndex * 2 + 1]) * fraction;

      spans.forEach(function (span) {
        const start = Math.max(0, tipIndex - span[0]);
        strokePath(screen, start, tipIndex, color, span[1] * edge, span[2] * weight);
        if (tipIndex > start) {
          context.beginPath();
          context.moveTo(screen[tipIndex * 2], screen[tipIndex * 2 + 1]);
          context.lineTo(tipX, tipY);
          context.strokeStyle = color;
          context.globalAlpha = span[1] * edge;
          context.lineWidth = span[2] * weight;
          context.stroke();
        }
      });

      context.beginPath();
      context.arc(tipX, tipY, 3.1 * weight, 0, Math.PI * 2);
      context.fillStyle = paper;
      context.globalAlpha = 0.92 * edge;
      context.fill();
      context.beginPath();
      context.arc(tipX, tipY, 1.85 * weight, 0, Math.PI * 2);
      context.fillStyle = color;
      context.globalAlpha = edge;
      context.fill();
    });

    context.globalAlpha = 1;
  }

  function step(timestamp) {
    const dt = lastTime ? Math.min(64, timestamp - lastTime) : 16;
    lastTime = timestamp;

    if (!drag.active) {
      view.yaw += view.velocity * dt + driftPerMs * dt;
      view.velocity *= Math.pow(0.94, dt / 16);
      if (Math.abs(view.velocity) < 0.00001) {
        view.velocity = 0;
      }
      view.pitch *= Math.pow(0.97, dt / 16);
    }

    const smoothing = 1 - Math.pow(0.9, dt / 16);
    view.tiltYaw += (view.targetTiltYaw - view.tiltYaw) * smoothing;
    view.tiltPitch += (view.targetTiltPitch - view.tiltPitch) * smoothing;

    if (morph.t < 1) {
      const before = ease(morph.t);
      morph.t = Math.min(1, morph.t + dt / morphMs);
      view.yaw += yawSwing * (ease(morph.t) - before);
      mixWorld();
    } else if (running && systems.length > 1) {
      holdLeft -= dt;
      if (holdLeft <= 0) {
        goTo((morph.target + 1) % systems.length);
      }
    }
  }

  function isSettled() {
    return !drag.active &&
      morph.t >= 1 &&
      view.velocity === 0 &&
      Math.abs(view.pitch) < 0.001 &&
      Math.abs(view.targetTiltYaw - view.tiltYaw) < 0.001 &&
      Math.abs(view.targetTiltPitch - view.tiltPitch) < 0.001;
  }

  function tick(timestamp) {
    frame = 0;
    step(timestamp);
    draw(timestamp);
    if (running || !isSettled()) {
      frame = window.requestAnimationFrame(tick);
    } else {
      lastTime = 0;
    }
  }

  function wake() {
    if (!frame) {
      frame = window.requestAnimationFrame(tick);
    }
  }

  function start() {
    draw(performance.now());
    if (running || reducedMotion) {
      return;
    }
    running = true;
    wake();
  }

  function stop() {
    running = false;
    lastTime = 0;
    if (frame) {
      window.cancelAnimationFrame(frame);
      frame = 0;
    }
  }

  /* Input */

  canvas.addEventListener("pointerdown", function (event) {
    drag.active = true;
    drag.id = event.pointerId;
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.time = event.timeStamp;
    view.velocity = 0;
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("is-dragging");
    wake();
  });

  canvas.addEventListener("pointermove", function (event) {
    if (!drag.active || event.pointerId !== drag.id) {
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    const dt = Math.max(1, event.timeStamp - drag.time);
    const radiansPerPixel = 3 / Math.max(200, width);
    view.yaw += dx * radiansPerPixel;
    view.pitch = Math.max(-maxPitch, Math.min(maxPitch, view.pitch + dy * radiansPerPixel));
    view.velocity = (dx * radiansPerPixel) / dt;
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.time = event.timeStamp;
    wake();
  });

  function endDrag(event) {
    if (!drag.active || event.pointerId !== drag.id) {
      return;
    }
    drag.active = false;
    if (event.timeStamp - drag.time > 80) {
      view.velocity = 0;
    }
    canvas.classList.remove("is-dragging");
    wake();
  }

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  const hero = canvas.closest(".hero") || document.body;
  if (finePointer) {
    hero.addEventListener("pointermove", function (event) {
      if (drag.active) {
        return;
      }
      const bounds = canvas.getBoundingClientRect();
      const nx = (event.clientX - (bounds.left + bounds.width / 2)) / window.innerWidth;
      const ny = (event.clientY - (bounds.top + bounds.height / 2)) / window.innerHeight;
      view.targetTiltYaw = Math.max(-0.35, Math.min(0.35, nx * 0.6));
      view.targetTiltPitch = Math.max(-0.2, Math.min(0.2, ny * 0.4));
      wake();
    });
    hero.addEventListener("pointerleave", function () {
      view.targetTiltYaw = 0;
      view.targetTiltPitch = 0;
      wake();
    });
  }

  const stageName = document.querySelector(".stage-name");
  window.addEventListener("attractorchange", function (event) {
    if (stageName) {
      stageName.textContent = systems[event.detail.index].label;
    }
  });

  resize();
  start();

  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(function () {
      resize();
      draw(performance.now());
    });
    observer.observe(canvas);
  } else {
    window.addEventListener("resize", function () {
      resize();
      draw(performance.now());
    });
  }

  window.addEventListener("themechange", function () {
    readPalette();
    draw(performance.now());
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      stop();
    } else {
      start();
    }
  });
}());
