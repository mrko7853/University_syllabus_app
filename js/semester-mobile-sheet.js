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
      label: String(option.textContent || option.label || option.value || '').trim()
    }))
    .filter((option) => option.value && option.label);
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

  const { layer, sheet, onKeyDown, onResize, closeTimer } = activeSheetState;
  if (closeTimer) {
    window.clearTimeout(closeTimer);
    activeSheetState.closeTimer = null;
  }

  document.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('resize', onResize);
  document.body.classList.remove('semester-mobile-sheet-open');
  document.body.classList.remove('modal-open');

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

export function shouldOpenSemesterMobileSheet(targetSelect) {
  return isMobileViewport() && isSemesterTargetSelect(targetSelect);
}

export function openSemesterMobileSheet({
  targetSelect,
  title = 'Current Term',
  description = 'Used for courses, schedule, and assignments'
} = {}) {
  if (!shouldOpenSemesterMobileSheet(targetSelect)) return false;

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
  sheet.className = 'semester-mobile-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', title);

  const indicator = document.createElement('div');
  indicator.className = 'swipe-indicator';
  indicator.setAttribute('aria-hidden', 'true');

  const header = document.createElement('div');
  header.className = 'semester-mobile-sheet-header';

  const heading = document.createElement('h2');
  heading.textContent = title;

  header.appendChild(heading);

  const subtitle = document.createElement('p');
  subtitle.className = 'semester-mobile-sheet-description';
  subtitle.textContent = description;

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
  cancelButton.className = 'semester-mobile-sheet-cancel';
  cancelButton.textContent = 'Cancel';

  footer.appendChild(cancelButton);

  sheet.appendChild(indicator);
  sheet.appendChild(header);
  sheet.appendChild(subtitle);
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
    closeTimer: null
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
