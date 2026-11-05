(function () {
  const root = document.documentElement;
  const button = document.querySelector(".theme-toggle");
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  function isDark() {
    if (root.dataset.theme) {
      return root.dataset.theme === "dark";
    }
    return systemDark.matches;
  }

  function sync() {
    const dark = isDark();
    root.classList.toggle("is-dark", dark);
    if (button) {
      button.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    }
    window.dispatchEvent(new Event("themechange"));
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function apply(next) {
    root.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch (error) {}
    sync();
  }

  if (button) {
    button.addEventListener("click", function () {
      const next = isDark() ? "light" : "dark";
      if (!document.startViewTransition || reducedMotion.matches) {
        apply(next);
        return;
      }

      const bounds = button.getBoundingClientRect();
      const x = bounds.left + bounds.width / 2;
      const y = bounds.top + bounds.height / 2;
      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
      );

      const transition = document.startViewTransition(function () {
        apply(next);
      });
      transition.ready.then(function () {
        root.animate(
          {
            clipPath: [
              "circle(0px at " + x + "px " + y + "px)",
              "circle(" + radius + "px at " + x + "px " + y + "px)"
            ]
          },
          {
            duration: 650,
            easing: "cubic-bezier(0.4, 0, 0.2, 1)",
            pseudoElement: "::view-transition-new(root)"
          }
        );
      });
    });
  }

  systemDark.addEventListener("change", function () {
    if (!root.dataset.theme) {
      sync();
    }
  });

  sync();
}());
