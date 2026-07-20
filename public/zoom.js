/*
 * Adaptive UI scale.
 *
 * The interface is designed at 100% for large external monitors, which
 * makes it feel oversized on smaller laptops. This renders the whole app
 * between 80% (small laptops) and 100% (large monitors) based on the
 * viewport width, so it stays comfortable everywhere without a manual
 * browser-zoom step.
 *
 * Runs before <app-root> paints (referenced from index.html ahead of the
 * app bundle) so the app renders at the right scale from the first frame.
 * It reads window.innerWidth — the real device viewport, which CSS `zoom`
 * never changes — so setting the zoom can't feed back into the reading.
 *
 * Phones and tablets (< DESKTOP_MIN) are left at 100%: the app's own
 * responsive layout already owns those widths, and zooming them out would
 * shrink touch targets.
 */
(function () {
  var MIN_ZOOM = 0.8; // at/below DESKTOP_MIN
  var MAX_ZOOM = 1.0; // at/above FULL_WIDTH
  var DESKTOP_MIN = 1280; // narrower than this = tablet/phone → no scaling
  var FULL_WIDTH = 1920; // 1080p-class and wider render at full size

  function apply() {
    var w =
      window.innerWidth || document.documentElement.clientWidth || 0;
    var root = document.documentElement;
    if (w < DESKTOP_MIN) {
      root.style.zoom = '';
      return;
    }
    var t = (w - DESKTOP_MIN) / (FULL_WIDTH - DESKTOP_MIN);
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    var z = MIN_ZOOM + t * (MAX_ZOOM - MIN_ZOOM);
    root.style.zoom = String(Math.round(z * 100) / 100);
  }

  apply();

  // Re-evaluate on resize, coalesced to one run per frame.
  var pending = 0;
  window.addEventListener('resize', function () {
    if (pending) return;
    pending = window.requestAnimationFrame(function () {
      pending = 0;
      apply();
    });
  });
})();
