/*! SPDX-License-Identifier: GPL-3.0-only */
// Keep the whole connect panel on screen in any window: the single column when it fits, two columns in a wide
// window that is too short for it, and a uniform zoom when neither fits. Below MIN_ZOOM the panel scrolls instead.
const WIDE_MIN_WIDTH = 700;
const MIN_ZOOM = 0.6;

/** The layout and zoom for a panel of [available] size, given the sheet height each layout needs. */
export function choosePanelFit(available, heights) {
  if (heights.single <= available.height) return { layout: 'single', zoom: 1 };
  const wide = available.width >= WIDE_MIN_WIDTH && Number.isFinite(heights.wide);
  if (wide && heights.wide <= available.height) return { layout: 'wide', zoom: 1 };
  const layout = wide ? 'wide' : 'single';
  const zoom = Math.max(MIN_ZOOM, Math.min(1, available.height / heights[layout]));
  return { layout, zoom: Math.floor(zoom * 1000) / 1000 };
}

export function fitPanel(panel, sheet = panel.querySelector('.glass-sheet')) {
  let applying = false;
  const inner = () => {
    const style = getComputedStyle(panel);
    return {
      width: panel.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      height: panel.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
    };
  };
  // The sheet's height with its top margin, measured unzoomed in one layout.
  const measure = layout => {
    panel.dataset.layout = layout;
    return sheet.offsetHeight + parseFloat(getComputedStyle(sheet).marginTop);
  };
  const apply = () => {
    if (applying || panel.hidden || !panel.clientHeight) return;
    applying = true;
    sheet.style.zoom = '';
    const available = inner();
    const heights = { single: measure('single') };
    if (heights.single > available.height && available.width >= WIDE_MIN_WIDTH) heights.wide = measure('wide');
    const fit = choosePanelFit(available, heights);
    panel.dataset.layout = fit.layout;
    sheet.style.zoom = fit.zoom < 1 ? String(fit.zoom) : '';
    applying = false;
  };
  // The window, the panel being shown again, and text that changes the sheet's height (status, messages). Both
  // observers deliver batched, and neither watches what apply() changes (the panel's data-layout, the sheet's zoom).
  new ResizeObserver(apply).observe(panel);
  new MutationObserver(apply).observe(sheet, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  apply();
  return apply;
}
