const MOBILE_SEMESTER_SHEET_BREAKPOINT = 1023;
const SHEET_CLOSE_ANIMATION_MS = 320;

let activeSheetState = null;

function isMobileViewport() {
  return window.innerWidth <= MOBILE_SEMESTER_SHEET_BREAKPOINT;
}

function isSemesterTargetSelect(targetSelect) {
  if (!targetSelect) return false;
  const id = String(targetSelect.id || '');
  return (
    targetSelect.classList.contains('semester-select')
    || id === 'semester-select'
    || id === 'semester-select-mobile'
  );
}

function getSelectOptions(targetSelect) {
  if (!targetSelect?.options) return [];
  return Array.from(targetSelect.options)
    .map((option) => ({
      value: String(option.value || ''),
      label: String(option.textContent || option.label || option.value || '').trim(),
      color: String(option.dataset?.color || '').trim()
    }))
    .filter((option) => option.value && option.label);
}

function parseHexColor(hexColor) {
  const normalized = String(hexColor || '').trim();
  const match = normalized.match(/^#([0-9a-f]{3,8})$/i);
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3 || hex.length === 4) {
    hex = hex.split('').map((char) => char + char).join('');
  }
  if (hex.length !== 6 && hex.length !== 8) return null;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  if (![r, g, b].every(Number.isFinite)) return null;
  return { r, g, b };
}

function toRgba(color, alpha) {
  const parsed = parseHexColor(color);
  if (!parsed) return '';
  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${alpha})`;
}

function removeActiveSheetNode() {
  if (!activeSheetState?.layer?.isConnected) return;
  const { sheet } = activeSheetState;
  if (sheet && typeof sheet._swipeCleanup === 'function') {
    sheet._swipeCleanup();
  }
  activeSheetState.layer.remove();
}

export function closeSemesterMobileSheet({ immediate = false } = {}) {
  if (!activeSheetState) return;

  const {
    layer,
    sheet,
    onKeyDown,
    onResize,
    closeTimer,
    hadModalOpenClass = false
  } = activeSheetState;
  if (closeTimer) {
    window.clearTimeout(closeTimer);
    activeSheetState.closeTimer = null;
  }

  document.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('resize', onResize);
  document.body.classList.remove('semester-mobile-sheet-open');
  if (!hadModalOpenClass) {
    document.body.classList.remove('modal-open');
  }

  if (immediate) {
    removeActiveSheetNode();
    activeSheetState = null;
    return;
  }

  layer.classList.remove('show');
  sheet?.classList.remove('show');
  sheet?.classList.remove('swiping');
  layer.classList.add('closing');
  activeSheetState.closeTimer = window.setTimeout(() => {
    removeActiveSheetNode();
    activeSheetState = null;
  }, SHEET_CLOSE_ANIMATION_MS);
}

export function shouldOpenSemesterMobileSheet(targetSelect, { force = false } = {}) {
  return isMobileViewport() && (force || isSemesterTargetSelect(targetSelect));
}

export function openSemesterMobileSheet({
  targetSelect,
  title = 'Current Term',
  description = 'Used for courses, schedule, and assignments',
  force = false
} = {}) {
  if (!shouldOpenSemesterMobileSheet(targetSelect, { force })) return false;

  const options = getSelectOptions(targetSelect);
  if (!options.length) return false;

  closeSemesterMobileSheet({ immediate: true });

  const selectedValue = String(targetSelect.value || '');

  const layer = document.createElement('div');
  layer.className = 'semester-mobile-sheet-layer';
  layer.setAttribute('role', 'presentation');

  const backdrop = document.createElement('div');
  backdrop.className = 'semester-mobile-sheet-backdrop';

  const sheet = document.createElement('div');
  sheet.className = 'ui-swipe-sheet semester-mobile-sheet';
  sheet.dataset.swipeLockSelector = '.semester-mobile-sheet-options';
  const sheetVariant = String(targetSelect.dataset.mobileSheetVariant || '').trim();
  if (sheetVariant) {
    sheet.classList.add(`semester-mobile-sheet--${sheetVariant}`);
  }
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', title);

  const indicator = document.createElement('div');
  indicator.className = 'swipe-indicator ui-swipe-sheet__handle';
  indicator.setAttribute('aria-hidden', 'true');

  const header = document.createElement('div');
  header.className = 'semester-mobile-sheet-header';

  const heading = document.createElement('h2');
  heading.textContent = title;

  header.appendChild(heading);

  const subtitleText = String(description || '').trim();
  let subtitle = null;
  if (subtitleText) {
    subtitle = document.createElement('p');
    subtitle.className = 'semester-mobile-sheet-description';
    subtitle.textContent = subtitleText;
  }

  const optionsWrap = document.createElement('div');
  optionsWrap.className = 'semester-mobile-sheet-options';

  options.forEach((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'semester-mobile-sheet-option';
    button.dataset.value = option.value;
    if (option.value === selectedValue) {
      button.classList.add('is-selected');
    }
    const optionBg = option.color || '';
    const optionBorder = toRgba(option.color, 0.62);
    const optionSelectedBg = option.color || '';
    const optionSelectedBorder = toRgba(option.color, 0.86);
    if (optionBg && optionBorder) {
      button.classList.add('semester-mobile-sheet-option--course-tinted');
      button.style.setProperty('--semester-option-bg', optionBg);
      button.style.setProperty('--semester-option-border', optionBorder);
      button.style.setProperty('--semester-option-selected-bg', optionSelectedBg || optionBg);
      button.style.setProperty('--semester-option-selected-border', optionSelectedBorder || optionBorder);
    }

    const label = document.createElement('span');
    label.className = 'semester-mobile-sheet-option-label';
    label.textContent = option.label;

    const check = document.createElement('span');
    check.className = 'semester-mobile-sheet-option-check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = option.value === selectedValue ? '✓' : '';

    button.appendChild(label);
    button.appendChild(check);
    optionsWrap.appendChild(button);
  });

  const footer = document.createElement('div');
  footer.className = 'semester-mobile-sheet-footer';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'ui-btn ui-btn--secondary semester-mobile-sheet-cancel control-surface control-surface--secondary';
  cancelButton.textContent = 'Cancel';

  footer.appendChild(cancelButton);

  sheet.appendChild(indicator);
  sheet.appendChild(header);
  if (subtitle) {
    sheet.appendChild(subtitle);
  }
  sheet.appendChild(optionsWrap);
  sheet.appendChild(footer);
  layer.appendChild(backdrop);
  layer.appendChild(sheet);
  document.body.appendChild(layer);

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSemesterMobileSheet();
    }
  };

  const onResize = () => {
    if (!isMobileViewport()) {
      closeSemesterMobileSheet({ immediate: true });
    }
  };

  activeSheetState = {
    layer,
    sheet,
    onKeyDown,
    onResize,
    closeTimer: null,
    hadModalOpenClass: document.body.classList.contains('modal-open')
  };

  const selectOption = (value) => {
    if (!value) return;
    targetSelect.value = value;
    targetSelect.dispatchEvent(new Event('change', { bubbles: true }));
    closeSemesterMobileSheet();
  };

  layer.addEventListener('click', (event) => {
    const optionButton = event.target.closest('.semester-mobile-sheet-option');
    if (optionButton) {
      event.preventDefault();
      selectOption(optionButton.dataset.value || '');
      return;
    }

    if (event.target === backdrop || event.target === cancelButton) {
      event.preventDefault();
      closeSemesterMobileSheet();
    }
  });

  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', onResize);
  document.body.classList.add('semester-mobile-sheet-open');
  document.body.classList.add('modal-open');

  if (typeof window.addSwipeToCloseSimple === 'function') {
    window.addSwipeToCloseSimple(sheet, backdrop, () => {
      closeSemesterMobileSheet({ immediate: true });
    });
  }

  window.requestAnimationFrame(() => {
    layer.classList.add('show');
    sheet.classList.add('show');
  });

  window.setTimeout(() => {
    cancelButton.focus({ preventScroll: true });
  }, 20);

  return true;
}
