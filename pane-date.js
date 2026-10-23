/*! SPDX-License-Identifier: GPL-3.0-only */
export function formatPaneDate(date, locale = 'zh-CN') {
  const parts = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'short' }).formatToParts(date);
  const value = type => parts.find(part => part.type === type)?.value || '';
  return locale.toLowerCase().startsWith('zh')
    ? `${value('month')}月${value('day')}日 · ${value('weekday')}`
    : `${new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date)} · ${value('weekday')}`;
}

export function createPaneDate(element, { now = () => new Date(), locale = navigator.language, setTimer = setInterval, clearTimer = clearInterval } = {}) {
  let timer = null;
  const update = () => {
    const date = now();
    element.textContent = formatPaneDate(date, locale);
    element.dateTime = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  return top => {
    element.hidden = !(top > 0);
    element.style.height = `${Math.max(0, top)}px`;
    if (top > 0) { update(); timer ??= setTimer(update, 30000); }
    else if (timer !== null) { clearTimer(timer); timer = null; }
  };
}
