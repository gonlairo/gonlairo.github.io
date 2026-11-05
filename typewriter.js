(function () {
  const heading = document.querySelector(".hero h1");
  if (!heading) {
    return;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    heading.classList.add("is-static");
    return;
  }

  const startDelay = 350;
  const lines = Array.from(heading.querySelectorAll(".line"));
  const chars = [];

  // Every letter is laid out from the start and only revealed, so nothing reflows while typing.
  lines.forEach(function (line, lineIndex) {
    const text = line.textContent;
    line.textContent = "";
    line.setAttribute("aria-hidden", "true");
    Array.from(text).forEach(function (letter) {
      const span = document.createElement("span");
      span.className = "char";
      span.textContent = letter;
      line.appendChild(span);
      chars.push({ span: span, letter: letter, lineEnd: false });
    });
    if (chars.length && lineIndex < lines.length - 1) {
      chars[chars.length - 1].lineEnd = true;
    }
  });

  if (!chars.length) {
    heading.classList.add("is-static");
    return;
  }

  const caret = document.createElement("span");
  caret.className = "caret is-typing";
  caret.setAttribute("aria-hidden", "true");
  lines[0].prepend(caret);

  function delayAfter(item) {
    if (item.lineEnd) {
      return 230;
    }
    if (item.letter === " ") {
      return 140;
    }
    return 48 + Math.random() * 55;
  }

  let index = 0;

  function typeNext() {
    const item = chars[index];
    item.span.classList.add("is-typed");
    item.span.after(caret);
    index += 1;
    if (index < chars.length) {
      window.setTimeout(typeNext, delayAfter(item));
    } else {
      caret.classList.remove("is-typing");
      caret.classList.add("is-done");
    }
  }

  window.setTimeout(typeNext, startDelay);
}());
