const APP_FIELD_ERROR_CLASS = "app-input-error";
const APP_FIELD_ERROR_MESSAGE_CLASS = "app-field-error-message";
const APP_FIELD_ERROR_VISIBLE_CLASS = "is-visible";
const APP_FIELD_ERROR_FOR_ATTR = "data-field-error-for";

let appFieldErrorIdCounter = 0;
let appFieldErrorUiInitialized = false;

function isElement(value) {
    return value instanceof HTMLElement;
}

function resolveElement(target, root = document) {
    if (!target) return null;
    if (isElement(target)) return target;
    if (typeof target !== "string") return null;
    return root.querySelector(target);
}

function asRoot(root) {
    if (root instanceof Document || root instanceof HTMLElement) return root;
    return document;
}

function ensureElementId(element) {
    if (!isElement(element)) return "";
    if (element.id) return element.id;
    appFieldErrorIdCounter += 1;
    element.id = `app-field-${appFieldErrorIdCounter}`;
    return element.id;
}

function escapeCssSelector(value) {
    if (typeof window !== "undefined" && window.CSS && typeof window.CSS.escape === "function") {
        return window.CSS.escape(String(value));
    }
    return String(value).replace(/["\\]/g, "\\$&");
}

function isConstraintField(element) {
    return element instanceof HTMLInputElement
        || element instanceof HTMLTextAreaElement
        || element instanceof HTMLSelectElement;
}

function getValidationMessage(element) {
    if (!isConstraintField(element) || !element.validity) return "Please check this field.";

    if (element.validity.valueMissing) return "This field is required.";
    if (element.validity.typeMismatch) {
        if (element instanceof HTMLInputElement && element.type === "email") {
            return "Please enter a valid email address.";
        }
        return "Please enter a valid value.";
    }
    if (element.validity.tooShort) {
        const min = Number(element.minLength);
        if (Number.isFinite(min) && min > 0) {
            return `Please enter at least ${min} characters.`;
        }
        return "This value is too short.";
    }
    if (element.validity.tooLong) {
        const max = Number(element.maxLength);
        if (Number.isFinite(max) && max > 0) {
            return `Please enter no more than ${max} characters.`;
        }
        return "This value is too long.";
    }
    if (element.validity.patternMismatch) return "Please match the requested format.";
    if (element.validity.rangeUnderflow) return "Please enter a larger value.";
    if (element.validity.rangeOverflow) return "Please enter a smaller value.";
    if (element.validity.stepMismatch) return "Please enter a valid value.";
    if (element.validity.badInput) return "Please enter a valid value.";

    const fallback = String(element.validationMessage || "").trim();
    return fallback || "Please check this field.";
}

function ensureErrorMessageElement(control, {
    root = document,
    anchor = null,
    messageElement = null
} = {}) {
    const scopedRoot = asRoot(root);
    const resolvedControl = resolveElement(control, scopedRoot);
    if (!resolvedControl) return null;

    const resolvedMessageElement = resolveElement(messageElement, scopedRoot);
    if (resolvedMessageElement) {
        resolvedMessageElement.classList.add(APP_FIELD_ERROR_MESSAGE_CLASS);
        return resolvedMessageElement;
    }

    const controlId = ensureElementId(resolvedControl);
    if (controlId) {
        const existing = scopedRoot.querySelector(`[${APP_FIELD_ERROR_FOR_ATTR}="${escapeCssSelector(controlId)}"]`);
        if (existing instanceof HTMLElement) {
            existing.classList.add(APP_FIELD_ERROR_MESSAGE_CLASS);
            return existing;
        }
    }

    const resolvedAnchor = resolveElement(anchor, scopedRoot) || resolvedControl;
    const parent = resolvedAnchor.parentElement;
    if (!parent) return null;

    const messageNode = document.createElement("p");
    messageNode.className = APP_FIELD_ERROR_MESSAGE_CLASS;
    if (controlId) {
        messageNode.setAttribute(APP_FIELD_ERROR_FOR_ATTR, controlId);
    }
    messageNode.hidden = true;
    messageNode.style.display = "none";

    if (resolvedAnchor.nextSibling) {
        parent.insertBefore(messageNode, resolvedAnchor.nextSibling);
    } else {
        parent.appendChild(messageNode);
    }

    return messageNode;
}

function showErrorMessage(node, message) {
    if (!isElement(node)) return;
    node.textContent = String(message || "").trim();
    node.hidden = false;
    node.style.display = "flex";
    node.classList.add(APP_FIELD_ERROR_MESSAGE_CLASS, APP_FIELD_ERROR_VISIBLE_CLASS);
}

function hideErrorMessage(node) {
    if (!isElement(node)) return;
    node.textContent = "";
    node.hidden = true;
    node.style.display = "none";
    node.classList.remove(APP_FIELD_ERROR_VISIBLE_CLASS);
}

function appendDescribedBy(control, messageNode) {
    if (!isElement(control) || !isElement(messageNode)) return;
    const messageId = ensureElementId(messageNode);
    if (!messageId) return;

    const existing = String(control.getAttribute("aria-describedby") || "")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean);

    if (!existing.includes(messageId)) {
        existing.push(messageId);
        control.setAttribute("aria-describedby", existing.join(" "));
    }
}

function removeDescribedBy(control, messageNode) {
    if (!isElement(control) || !isElement(messageNode) || !messageNode.id) return;
    const existing = String(control.getAttribute("aria-describedby") || "")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean)
        .filter((token) => token !== messageNode.id);
    if (existing.length > 0) {
        control.setAttribute("aria-describedby", existing.join(" "));
    } else {
        control.removeAttribute("aria-describedby");
    }
}

export function setFieldError(control, message, {
    root = document,
    anchor = null,
    highlightTarget = null,
    messageElement = null
} = {}) {
    const scopedRoot = asRoot(root);
    const resolvedControl = resolveElement(control, scopedRoot);
    if (!resolvedControl) return null;

    const resolvedHighlightTarget = resolveElement(highlightTarget, scopedRoot) || resolvedControl;
    const resolvedMessage = String(message || "").trim() || getValidationMessage(resolvedControl);
    const messageNode = ensureErrorMessageElement(resolvedControl, {
        root: scopedRoot,
        anchor,
        messageElement
    });

    resolvedControl.classList.add(APP_FIELD_ERROR_CLASS);
    resolvedControl.setAttribute("aria-invalid", "true");

    if (resolvedHighlightTarget && resolvedHighlightTarget !== resolvedControl) {
        resolvedHighlightTarget.classList.add(APP_FIELD_ERROR_CLASS);
        resolvedHighlightTarget.setAttribute("aria-invalid", "true");
    }

    if (messageNode) {
        showErrorMessage(messageNode, resolvedMessage);
        appendDescribedBy(resolvedControl, messageNode);
    }

    return messageNode;
}

export function clearFieldError(control, {
    root = document,
    highlightTarget = null,
    messageElement = null
} = {}) {
    const scopedRoot = asRoot(root);
    const resolvedControl = resolveElement(control, scopedRoot);
    if (!resolvedControl) return null;

    const resolvedHighlightTarget = resolveElement(highlightTarget, scopedRoot);
    const resolvedMessageElement = resolveElement(messageElement, scopedRoot)
        || (() => {
            const controlId = String(resolvedControl.id || "").trim();
            if (!controlId) return null;
            return scopedRoot.querySelector(`[${APP_FIELD_ERROR_FOR_ATTR}="${escapeCssSelector(controlId)}"]`);
        })();

    resolvedControl.classList.remove(APP_FIELD_ERROR_CLASS);
    resolvedControl.removeAttribute("aria-invalid");

    if (resolvedHighlightTarget) {
        resolvedHighlightTarget.classList.remove(APP_FIELD_ERROR_CLASS);
        resolvedHighlightTarget.removeAttribute("aria-invalid");
    }

    if (resolvedMessageElement) {
        hideErrorMessage(resolvedMessageElement);
        removeDescribedBy(resolvedControl, resolvedMessageElement);
    }

    return resolvedMessageElement;
}

export function clearFieldErrors(scope = document) {
    const root = asRoot(scope);
    root.querySelectorAll(`.${APP_FIELD_ERROR_CLASS}`).forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        node.classList.remove(APP_FIELD_ERROR_CLASS);
        node.removeAttribute("aria-invalid");
    });

    root.querySelectorAll(`.${APP_FIELD_ERROR_MESSAGE_CLASS}`).forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        hideErrorMessage(node);
    });
}

function maybeClearInvalidState(event) {
    const target = event?.target;
    if (!isConstraintField(target)) return;
    if (!target.classList.contains(APP_FIELD_ERROR_CLASS)) return;
    if (!target.validity.valid) return;
    clearFieldError(target);
}

export function initializeGlobalFieldErrorUI() {
    if (appFieldErrorUiInitialized || typeof document === "undefined") return;
    appFieldErrorUiInitialized = true;

    document.addEventListener("invalid", (event) => {
        const target = event?.target;
        if (!isConstraintField(target)) return;
        if (target.validity.valid) return;
        event.preventDefault();
        setFieldError(target, getValidationMessage(target));
    }, true);

    document.addEventListener("input", maybeClearInvalidState, true);
    document.addEventListener("change", maybeClearInvalidState, true);
}

initializeGlobalFieldErrorUI();

export {
    APP_FIELD_ERROR_CLASS,
    APP_FIELD_ERROR_MESSAGE_CLASS
};
