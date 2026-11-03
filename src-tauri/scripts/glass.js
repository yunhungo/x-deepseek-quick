/*
 * DeepSeek Glass — page background softening.
 *
 * This initialization script runs in the main webview before the remote
 * page's own scripts. It only changes background colors. It does not read
 * the DOM for content, does not send anything off-device, and does not
 * touch DeepSeek's login or chat logic.
 *
 * What it changes, and only on hostnames listed in allowedHosts:
 * - On Linux, `clearShell` is set. WebKitGTK flattens stacked translucent
 *   sheets into an opaque white page, and transparent webview pixels replace
 *   whatever GTK painted underneath. The frost is therefore one layer: `html`
 *   at 50% white, which the compositor blends with the desktop. `body` is
 *   cleared. macOS and Windows keep the configured shell alpha over the
 *   native material.
 * - Large elements with an opaque, solid background are collected.
 * - When those large children cover almost the whole parent, the parent is
 *   cleared and only the children are tinted. That keeps one frost layer
 *   instead of stacking several translucent sheets into something opaque.
 * - When a parent still has visible gaps (a login card, a footer), the
 *   parent is tinted and the smaller children stay opaque, so text sitting
 *   outside the card keeps a readable surface.
 * - Inputs, buttons, links, images, canvas, editors, and dialogs are left
 *   alone.
 *
 * Set glass.enabled to false in launcher.json to load the site untouched.
 * Thresholds and alphas come from window.__DEEPSEEK_GLASS__, injected by Rust.
 */
(() => {
  const cfg = window.__DEEPSEEK_GLASS__;
  if (!cfg || cfg.enabled !== true) return;

  const hosts = new Set(
    (Array.isArray(cfg.allowedHosts) ? cfg.allowedHosts : [])
      .map((host) => String(host).trim().toLowerCase())
      .filter(Boolean),
  );
  if (!hosts.has(location.hostname)) return;

  function clamp(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  const shellAlpha = cfg.clearShell === true ? 0 : clamp(cfg.shellAlpha, 0.74, 0.55, 1);
  const panelAlpha = clamp(cfg.panelAlpha, 0.88, 0.55, 1);
  const shellCoverage = clamp(cfg.shellCoverage, 0.82, 0.5, 1);
  const panelWidthCoverage = clamp(cfg.panelWidthCoverage, 0.28, 0.15, 1);
  const panelHeightCoverage = clamp(cfg.panelHeightCoverage, 0.62, 0.3, 1);

  if (shellAlpha >= 0.995 && panelAlpha >= 0.995) return;

  const SKIP_TAGS = new Set([
    "INPUT",
    "TEXTAREA",
    "BUTTON",
    "SELECT",
    "OPTION",
    "CANVAS",
    "IMG",
    "VIDEO",
    "SVG",
    "PICTURE",
    "IFRAME",
    "A",
    "AUDIO",
  ]);

  let scheduled = false;

  function install() {
    if (!document.documentElement || !document.body) return;
    if (document.documentElement.dataset.glassInstalled === "1") return;
    document.documentElement.dataset.glassInstalled = "1";

    const style = document.createElement("style");
    style.id = "deepseek-glass-base";
    style.textContent =
      "html{background:transparent!important;}" +
      (cfg.clearShell === true
        ? "html{background-color:rgba(255,255,255,0.5)!important;background-image:none!important;}body{background-color:transparent!important;background-image:none!important;}"
        : "");
    (document.head || document.documentElement).appendChild(style);

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "childList" || record.type === "attributes") {
          schedule();
          return;
        }
      }
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    window.addEventListener("resize", schedule, { passive: true });
    schedule();
    window.setTimeout(schedule, 600);
    window.setTimeout(schedule, 1800);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(() => {
      scheduled = false;
      try {
        soften();
      } catch (error) {
        console.warn("DeepSeek Glass: background pass skipped.", error);
      }
    }, 200);
  }

  function isSkippable(el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.isContentEditable) return true;
    const role = el.getAttribute("role");
    if (role === "dialog" || role === "alertdialog" || role === "menu" || role === "listbox") {
      return true;
    }
    return Boolean(el.closest("[role='dialog'],[role='alertdialog'],[aria-modal='true']"));
  }

  function parseColor(color) {
    const match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(
      color,
    );
    if (!match) return null;
    return {
      r: Number(match[1]),
      g: Number(match[2]),
      b: Number(match[3]),
      a: match[4] === undefined ? 1 : Number(match[4]),
    };
  }

  function authoredPaint(el) {
    const priority = el.style.getPropertyPriority("background-color");
    const inline = el.style.getPropertyValue("background-color");
    const marked = el.hasAttribute("data-glass-alpha");
    if (marked) el.style.removeProperty("background-color");
    const view = getComputedStyle(el);
    const backgroundColor = view.backgroundColor;
    const backgroundImage = view.backgroundImage;
    if (marked && inline) el.style.setProperty("background-color", inline, priority);
    return { backgroundColor, backgroundImage };
  }

  function coverageAlpha(rect) {
    const width = window.innerWidth || 1;
    const height = window.innerHeight || 1;
    const coverW = rect.width / width;
    const coverH = rect.height / height;
    if (coverW >= shellCoverage && coverH >= shellCoverage) return shellAlpha;
    if (coverW >= panelWidthCoverage && coverH >= panelHeightCoverage) return panelAlpha;
    return null;
  }

  function paint(el, color, mark) {
    if (
      el.getAttribute("data-glass-alpha") === mark &&
      el.style.getPropertyValue("background-color") === color
    ) {
      return;
    }
    el.style.setProperty("background-color", color, "important");
    el.setAttribute("data-glass-alpha", mark);
  }

  function leavesOf(found) {
    return found.filter((el) => !found.some((other) => other !== el && el.contains(other)));
  }

  function coveredByLeaves(el, leaves) {
    const kids = leaves.filter((leaf) => leaf !== el && el.contains(leaf));
    if (kids.length === 0) return false;
    const prect = el.getBoundingClientRect();
    if (prect.width < 1 || prect.height < 1) return false;
    const cols = 6;
    const rows = 6;
    let hit = 0;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const px = prect.left + (prect.width * (x + 0.5)) / cols;
        const py = prect.top + (prect.height * (y + 0.5)) / rows;
        const inside = kids.some((child) => {
          const rect = child.getBoundingClientRect();
          return px >= rect.left && px < rect.right && py >= rect.top && py < rect.bottom;
        });
        if (inside) hit += 1;
      }
    }
    return hit / (cols * rows) >= 0.85;
  }

  function tint(el) {
    const target = coverageAlpha(el.getBoundingClientRect());
    const parsed = parseColor(authoredPaint(el).backgroundColor);
    if (!parsed || target == null) return;
    paint(
      el,
      `rgba(${Math.round(parsed.r)}, ${Math.round(parsed.g)}, ${Math.round(parsed.b)}, ${target})`,
      String(target),
    );
  }

  function soften() {
    const found = [];
    sampleViewport(found);
    collect(document.body, 0, found);
    const leaves = leavesOf(found);
    const clearBranches = new Set();
    const paintBranches = new Set();
    for (const el of found) {
      if (leaves.includes(el)) continue;
      if (coveredByLeaves(el, leaves)) clearBranches.add(el);
      else paintBranches.add(el);
    }
    const paintLeaves = leaves.filter(
      (leaf) => ![...paintBranches].some((branch) => branch.contains(leaf)),
    );
    const keep = new Set([...clearBranches, ...paintBranches, ...paintLeaves]);

    document.querySelectorAll("[data-glass-alpha]").forEach((node) => {
      if (!(node instanceof HTMLElement) || keep.has(node)) return;
      node.style.removeProperty("background-color");
      node.removeAttribute("data-glass-alpha");
    });

    for (const el of clearBranches) paint(el, "rgba(0, 0, 0, 0)", "clear");
    for (const el of paintBranches) tint(el);
    for (const el of paintLeaves) tint(el);
  }

  function consider(el, out) {
    if (!(el instanceof HTMLElement) || isSkippable(el)) return;
    // Linux paints one frost on <html>. Clearing or tinting html/body here
    // would stack a second sheet, or wipe the frost.
    if (cfg.clearShell === true && (el === document.documentElement || el === document.body)) {
      return;
    }
    if (out.includes(el) || out.length >= 80) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 160 || rect.height < 120) return;
    const target = coverageAlpha(rect);
    if (target == null) return;
    const paintInfo = authoredPaint(el);
    const parsed = parseColor(paintInfo.backgroundColor);
    const solid = !paintInfo.backgroundImage || paintInfo.backgroundImage === "none";
    if (solid && parsed && parsed.a >= 0.96) out.push(el);
  }

  // elementFromPoint returns nodes inside an open shadow tree, and
  // parentElement stops at the shadow boundary. A custom-element shell
  // keeps its opaque background if we only walk light DOM.
  function parentAcrossShadow(node) {
    if (!(node instanceof Element)) return null;
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode();
    if (root instanceof ShadowRoot) return root.host;
    return null;
  }

  function sampleViewport(out) {
    const width = window.innerWidth || 1;
    const height = window.innerHeight || 1;
    const cols = 4;
    const rows = 4;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        let node = document.elementFromPoint(
          (width * (x + 0.5)) / cols,
          (height * (y + 0.5)) / rows,
        );
        let guard = 0;
        while (node && guard < 14) {
          consider(node, out);
          node = parentAcrossShadow(node);
          guard += 1;
        }
      }
    }
  }

  function collect(el, depth, out) {
    if (!(el instanceof HTMLElement) || depth > 12 || out.length >= 80) return;
    consider(el, out);
    if (el.shadowRoot) {
      for (const child of el.shadowRoot.children) {
        collect(child, depth + 1, out);
        if (out.length >= 80) return;
      }
    }
    for (const child of el.children) {
      collect(child, depth + 1, out);
      if (out.length >= 80) return;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
