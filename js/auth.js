import { supabase } from "../supabase.js";
import { getCurrentAppPath, withBase } from "./path-utils.js";
import { clearFieldError, clearFieldErrors, initializeGlobalFieldErrorUI, setFieldError } from "./field-errors.js";

const AUTH_SUCCESS_TOAST_KEY = "ila_auth_success_toast";
const AUTH_SUCCESS_TOAST_MESSAGE = "Login successful.";
const AUTH_PASSWORD_UPDATED_TOAST_MESSAGE = "Password updated. You're now signed in.";
const AUTH_EXPECTED_OAUTH_EMAIL_KEY = "ila_auth_expected_oauth_email";
const ROUTE_TOAST_QUEUE_KEY = "ila_route_toast";
const PASSWORD_RECOVERY_COOLDOWN_STORAGE_KEY = "ila_auth_password_recovery_cooldowns";
const PASSWORD_RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;
const FORGOT_PASSWORD_BUTTON_LABEL = "Forgot password?";
const EMAIL_SIGNIN_METHOD_LOOKUP_RPC = "get_email_signin_methods";
const MODAL_ID = "auth-unified-modal";
const DEDICATED_AUTH_ROUTES = new Set(["/login", "/register"]);
const PROTECTED_NAV_TEASERS = {
    "/timetable": {
        title: "Plan your week with the timetable",
        description: "Save courses and instantly see your full class schedule in one place.",
        image: withBase("/screen-feature2.png")
    },
    "/assignments": {
        title: "Track every assignment deadline",
        description: "Organize tasks, due dates, and status updates so nothing is missed.",
        image: withBase("/screen-feature1.png")
    },
    "/profile": {
        title: "Keep your account in sync",
        description: "Manage your account, preferences, and connected sign-in methods.",
        image: withBase("/screen-feature4.png")
    }
};

function queueAuthSuccessToast(message = AUTH_SUCCESS_TOAST_MESSAGE) {
    try {
        window.sessionStorage.setItem(AUTH_SUCCESS_TOAST_KEY, String(message || AUTH_SUCCESS_TOAST_MESSAGE));
    } catch (_) { }
}

function consumeAuthSuccessToast() {
    try {
        const message = window.sessionStorage.getItem(AUTH_SUCCESS_TOAST_KEY);
        if (!message) return "";
        window.sessionStorage.removeItem(AUTH_SUCCESS_TOAST_KEY);
        return message;
    } catch (_) {
        return "";
    }
}

function consumeQueuedRouteToast() {
    try {
        const raw = window.sessionStorage.getItem(ROUTE_TOAST_QUEUE_KEY)
            || window.localStorage.getItem(ROUTE_TOAST_QUEUE_KEY);
        if (!raw) return null;
        window.sessionStorage.removeItem(ROUTE_TOAST_QUEUE_KEY);
        window.localStorage.removeItem(ROUTE_TOAST_QUEUE_KEY);

        let parsed = null;
        try {
            parsed = JSON.parse(raw);
        } catch (_) {
            parsed = null;
        }

        if (!parsed || typeof parsed !== "object") {
            const message = String(raw || "").trim();
            if (!message) return null;
            return { message, variant: "info", durationMs: 2600 };
        }

        const message = String(parsed.message || "").trim();
        if (!message) return null;
        const variant = String(parsed.variant || "info").trim().toLowerCase() === "error" ? "error" : "info";
        const durationMs = Number(parsed.durationMs) || 2600;
        return { message, variant, durationMs };
    } catch (_) {
        return null;
    }
}

function showAppToast(message, durationMs = 2200, variant = "info") {
    const normalized = String(message || "").trim();
    if (!normalized) return;

    const existingToast = document.getElementById("link-copied-notification");
    if (existingToast) existingToast.remove();

    const toast = document.createElement("div");
    toast.id = "link-copied-notification";
    if (variant === "error") {
        toast.classList.add("is-error");
    }
    toast.textContent = normalized;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add("show");
    });

    window.setTimeout(() => {
        toast.classList.remove("show");
        window.setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
    }, durationMs);
}

function isValidEmail(value) {
    const normalized = String(value || "").trim();
    if (!normalized) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

function normalizeEmailForStorage(email) {
    return String(email || "").trim().toLowerCase();
}

function readPasswordRecoveryCooldownMap() {
    try {
        const raw = window.localStorage.getItem(PASSWORD_RECOVERY_COOLDOWN_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return {};
        return parsed;
    } catch (_) {
        return {};
    }
}

function writePasswordRecoveryCooldownMap(map) {
    try {
        window.localStorage.setItem(PASSWORD_RECOVERY_COOLDOWN_STORAGE_KEY, JSON.stringify(map || {}));
    } catch (_) { }
}

function getPasswordRecoveryCooldownRemainingMs(email) {
    const normalizedEmail = normalizeEmailForStorage(email);
    if (!isValidEmail(normalizedEmail)) return 0;

    const cooldownMap = readPasswordRecoveryCooldownMap();
    const startedAt = Number(cooldownMap[normalizedEmail]);
    if (!Number.isFinite(startedAt) || startedAt <= 0) return 0;

    const remainingMs = (startedAt + PASSWORD_RECOVERY_COOLDOWN_MS) - Date.now();
    if (remainingMs > 0) return remainingMs;

    delete cooldownMap[normalizedEmail];
    writePasswordRecoveryCooldownMap(cooldownMap);
    return 0;
}

function markPasswordRecoverySent(email) {
    const normalizedEmail = normalizeEmailForStorage(email);
    if (!isValidEmail(normalizedEmail)) return;
    const cooldownMap = readPasswordRecoveryCooldownMap();
    cooldownMap[normalizedEmail] = Date.now();
    writePasswordRecoveryCooldownMap(cooldownMap);
}

function formatCooldownTimer(remainingMs) {
    const totalSeconds = Math.max(0, Math.ceil(Number(remainingMs || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function setExpectedOAuthEmail(email) {
    const normalized = String(email || "").trim().toLowerCase();
    if (!isValidEmail(normalized)) return;

    const payload = {
        email: normalized,
        createdAt: Date.now(),
        source: "oauth-signin"
    };

    try {
        const serialized = JSON.stringify(payload);
        window.sessionStorage.setItem(AUTH_EXPECTED_OAUTH_EMAIL_KEY, serialized);
        window.localStorage.setItem(AUTH_EXPECTED_OAUTH_EMAIL_KEY, serialized);
    } catch (_) { }
}

function clearExpectedOAuthEmail() {
    try {
        window.sessionStorage.removeItem(AUTH_EXPECTED_OAUTH_EMAIL_KEY);
        window.localStorage.removeItem(AUTH_EXPECTED_OAUTH_EMAIL_KEY);
    } catch (_) { }
}

function isOAuthEmailMismatchError(error) {
    const message = String(error?.message || "").toLowerCase();
    const hasEmailMismatch = message.includes("email")
        && (
            message.includes("mismatch")
            || message.includes("different")
            || message.includes("does not match")
            || message.includes("must match")
        );
    const alreadyLinkedElsewhere = message.includes("identity already exists")
        || message.includes("already linked")
        || message.includes("already associated");
    return hasEmailMismatch || alreadyLinkedElsewhere;
}

function flushPendingAuthSuccessToast() {
    const pendingMessage = consumeAuthSuccessToast();
    if (pendingMessage) {
        showAppToast(pendingMessage);
    }

    const queuedRouteToast = consumeQueuedRouteToast();
    if (queuedRouteToast) {
        showAppToast(queuedRouteToast.message, queuedRouteToast.durationMs, queuedRouteToast.variant);
    }
}

function getAuthCallbackRedirectTo() {
    // Use trailing slash to target the generated directory alias directly (`/auth/callback/index.html`),
    // which is generally more reliable behind reverse proxies/CDNs.
    return `${window.location.origin}${withBase("/auth/callback/")}`;
}

function getPasswordRecoveryRedirectTo() {
    return `${window.location.origin}${withBase("/login/?auth_intent=password-reset")}`;
}

function navigateAfterAuthSuccess(message = AUTH_SUCCESS_TOAST_MESSAGE) {
    queueAuthSuccessToast(message);
    if (window.router?.navigate) {
        window.router.navigate("/");
        return;
    }
    window.location.href = withBase("/");
}

function getAuthErrorMessage(error, fallback = "Authentication failed. Please try again.") {
    const message = String(error?.message || "").trim();
    return message || fallback;
}

function getOAuthProviderDisplayName(provider) {
    if (provider === "google") return "Google";
    if (provider === "azure") return "Outlook";
    const normalized = String(provider || "").trim().toLowerCase();
    if (!normalized) return "OAuth";
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getOAuthOptions(provider) {
    const options = {
        redirectTo: getAuthCallbackRedirectTo()
    };

    if (provider === "azure") {
        options.scopes = "email";
    }

    return options;
}

function isInvalidCredentialsError(error) {
    const message = String(error?.message || "").toLowerCase();
    return message.includes("invalid login credentials");
}

function isEmailNotConfirmedError(error) {
    const message = String(error?.message || "").toLowerCase();
    return message.includes("email not confirmed");
}

function isUserAlreadyRegisteredError(error) {
    const message = String(error?.message || "").toLowerCase();
    return message.includes("user already registered") || message.includes("already been registered");
}

function normalizeOAuthProviderName(provider) {
    const normalized = String(provider || "").trim().toLowerCase();
    if (!normalized || normalized === "email" || normalized === "phone" || normalized === "anonymous") {
        return "";
    }
    if (normalized === "azuread" || normalized === "microsoft" || normalized === "outlook") {
        return "azure";
    }
    return normalized;
}

function isSupportedAuthOAuthProvider(provider) {
    const normalized = normalizeOAuthProviderName(provider);
    return normalized === "google" || normalized === "azure";
}

function isLikelyNetworkError(error) {
    const message = String(error?.message || "").toLowerCase();
    return message.includes("failed to fetch")
        || message.includes("networkerror")
        || message.includes("network request failed")
        || message.includes("load failed");
}

function normalizeMode(value) {
    return String(value || "").toLowerCase() === "signup" ? "signup" : "signin";
}

function normalizeAuthRoutePath(path = getCurrentAppPath()) {
    const raw = String(path || "").trim() || "/";
    if (raw === "/") return "/";
    return raw.replace(/\/+$/, "") || "/";
}

function getRouteDefaultMode(path = getCurrentAppPath()) {
    const normalizedPath = normalizeAuthRoutePath(path);
    return normalizedPath === "/register" ? "signup" : "signin";
}

function isProtectedRoute(route) {
    return route === "/timetable" || route === "/assignments" || route === "/profile";
}

function getActionLabelFromRoute(route) {
    if (route === "/timetable") return "open your timetable";
    if (route === "/assignments") return "open assignments";
    if (route === "/profile") return "open your profile";
    return "continue";
}

function isDesktopHoverEnvironment() {
    return window.innerWidth > 1023 && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function isMobileViewport() {
    return window.innerWidth <= 1023;
}

function createInlineMessageMarkup(id) {
    return `<p class="auth-inline-message" id="${id}" aria-live="polite"></p>`;
}

class AuthNavTeaserController {
    constructor(authManager) {
        this.authManager = authManager;
        this.root = null;
        this.currentTarget = null;
        this.currentRoute = "";
        this.showTimer = null;
        this.hideTimer = null;
        this.boundTargets = new Set();
        this.handleWindowResize = this.handleWindowResize.bind(this);
        this.handleDocumentScroll = this.handleDocumentScroll.bind(this);
    }

    init() {
        this.ensureRoot();
        this.bindTargets();
        window.addEventListener("resize", this.handleWindowResize, { passive: true });
        window.addEventListener("scroll", this.handleDocumentScroll, { passive: true });
    }

    handleWindowResize() {
        if (!this.currentTarget) return;
        if (!isDesktopHoverEnvironment()) {
            this.hideNow();
            return;
        }
        this.position();
    }

    handleDocumentScroll() {
        if (!this.currentTarget) return;
        this.position();
    }

    ensureRoot() {
        if (this.root && this.root.isConnected) return this.root;

        const root = document.createElement("aside");
        root.className = "auth-nav-teaser";
        root.hidden = true;
        root.innerHTML = `
            <div class="auth-nav-teaser-media" aria-hidden="true">
                <img class="auth-nav-teaser-image" alt="" loading="lazy" decoding="async">
            </div>
            <div class="auth-nav-teaser-content">
                <h3 class="auth-nav-teaser-title"></h3>
                <p class="auth-nav-teaser-description"></p>
                <div class="auth-nav-teaser-actions">
                    <button type="button" class="auth-nav-teaser-btn auth-nav-teaser-btn--primary" data-action="teaser-signin">Log in</button>
                    <button type="button" class="auth-nav-teaser-btn auth-nav-teaser-btn--secondary" data-action="teaser-signup">Sign up for free</button>
                </div>
            </div>
        `;

        root.addEventListener("mouseenter", () => {
            if (this.hideTimer) {
                window.clearTimeout(this.hideTimer);
                this.hideTimer = null;
            }
        });

        root.addEventListener("mouseleave", () => {
            this.scheduleHide();
        });

        root.addEventListener("click", (event) => {
            const actionButton = event.target.closest("button[data-action]");
            if (!actionButton) return;

            const route = this.currentRoute;
            const action = getActionLabelFromRoute(route);
            const onSuccess = route && window.router?.navigate
                ? () => window.router.navigate(route)
                : null;

            if (actionButton.dataset.action === "teaser-signup") {
                this.authManager.openSignUp({ action, source: "nav-teaser", onSuccess });
            } else {
                this.authManager.openSignIn({ action, source: "nav-teaser", onSuccess });
            }

            this.hideNow();
        });

        document.body.appendChild(root);
        this.root = root;
        return root;
    }

    bindTargets() {
        if (!isDesktopHoverEnvironment()) {
            this.hideNow();
            return;
        }

        const navButtons = Array.from(document.querySelectorAll("button.nav-btn[data-route]"));
        navButtons.forEach((button) => {
            const route = String(button.dataset.route || "").trim();
            if (!isProtectedRoute(route)) return;
            if (this.boundTargets.has(button)) return;
            this.boundTargets.add(button);

            button.addEventListener("mouseenter", () => {
                this.scheduleShow(button, route);
            });

            button.addEventListener("mouseleave", () => {
                this.scheduleHide();
            });
        });
    }

    async scheduleShow(button, route) {
        if (!button || !route) return;
        if (!isDesktopHoverEnvironment()) return;

        const isAuthenticated = await this.authManager.isAuthenticated();
        if (isAuthenticated) {
            this.hideNow();
            return;
        }

        if (this.hideTimer) {
            window.clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }

        if (this.showTimer) {
            window.clearTimeout(this.showTimer);
            this.showTimer = null;
        }

        this.showTimer = window.setTimeout(() => {
            this.show(button, route);
        }, 120);
    }

    scheduleHide() {
        if (this.showTimer) {
            window.clearTimeout(this.showTimer);
            this.showTimer = null;
        }

        if (this.hideTimer) {
            window.clearTimeout(this.hideTimer);
        }

        this.hideTimer = window.setTimeout(() => {
            this.hideNow();
        }, 140);
    }

    show(button, route) {
        const config = PROTECTED_NAV_TEASERS[route];
        if (!config) return;

        const root = this.ensureRoot();
        this.currentTarget = button;
        this.currentRoute = route;

        const image = root.querySelector(".auth-nav-teaser-image");
        const title = root.querySelector(".auth-nav-teaser-title");
        const description = root.querySelector(".auth-nav-teaser-description");

        if (image) image.src = config.image;
        if (title) title.textContent = config.title;
        if (description) description.textContent = config.description;

        root.hidden = false;
        root.classList.add("is-visible");

        this.position();
    }

    hideNow() {
        if (this.showTimer) {
            window.clearTimeout(this.showTimer);
            this.showTimer = null;
        }
        if (this.hideTimer) {
            window.clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }

        if (!this.root) return;
        this.root.classList.remove("is-visible");
        this.root.hidden = true;
        this.currentTarget = null;
        this.currentRoute = "";
    }

    position() {
        if (!this.root || !this.currentTarget || this.root.hidden) return;

        const targetRect = this.currentTarget.getBoundingClientRect();
        const rootRect = this.root.getBoundingClientRect();
        const spacing = 14;

        let left = targetRect.right + spacing;
        let top = targetRect.top + (targetRect.height / 2) - (rootRect.height / 2);

        const maxTop = window.innerHeight - rootRect.height - 12;
        top = Math.max(12, Math.min(top, maxTop));

        if ((left + rootRect.width) > (window.innerWidth - 12)) {
            left = targetRect.left - rootRect.width - spacing;
        }

        if (left < 12) {
            left = Math.max(12, window.innerWidth - rootRect.width - 12);
        }

        this.root.style.left = `${Math.round(left)}px`;
        this.root.style.top = `${Math.round(top)}px`;
    }
}

class UnifiedAuthManager {
    constructor() {
        this.currentModal = null;
        this.onSuccessCallback = null;
        this.activeContext = {
            action: "continue",
            source: "unknown"
        };
        this.modalState = {
            step: "entry",
            mode: "signin",
            email: ""
        };
        this.modalSubmissionInFlight = false;
        this.modalRecoveryRequestInFlight = false;
        this.pageState = {
            step: "entry",
            mode: "signin",
            email: ""
        };
        this.pageSubmissionInFlight = false;
        this.pageRecoveryRequestInFlight = false;
        this.forgotPasswordCooldownTimers = {
            "auth-modal": null,
            "auth-page": null
        };
        this.pageRoot = null;
        this.authStateSubscription = null;
        this.navTeaser = new AuthNavTeaserController(this);
        this.emailSignInMethodLookupAvailable = true;
        this.init();
    }

    init() {
        this.bindGlobalCloseEvents();
        this.bindPageLifecycleEvents();
        this.setupDedicatedAuthPage();
        this.navTeaser.init();
        this.bindAuthStateSubscription();
        this.bindGlobalAuthTriggers();
    }

    bindAuthStateSubscription() {
        if (this.authStateSubscription) return;
        const result = supabase.auth.onAuthStateChange((event) => {
            if (event === "SIGNED_IN") {
                this.navTeaser.hideNow();
            }
            if (event === "SIGNED_OUT") {
                this.navTeaser.bindTargets();
            }
        });
        this.authStateSubscription = result?.data?.subscription || null;
    }

    bindGlobalCloseEvents() {
        document.addEventListener("click", (event) => {
            if (event.target?.dataset?.action === "close-auth-modal" || event.target.classList.contains("auth-modal-background")) {
                this.closeCurrentModal();
            }
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && this.currentModal) {
                this.closeCurrentModal();
            }
        });
    }

    bindPageLifecycleEvents() {
        document.addEventListener("pageLoaded", () => {
            flushPendingAuthSuccessToast();
            this.setupDedicatedAuthPage();
            this.bindGlobalAuthTriggers();
            this.navTeaser.bindTargets();
        });
    }

    bindGlobalAuthTriggers() {
        document.querySelectorAll("[data-auth-open]").forEach((trigger) => {
            if (trigger.dataset.authBound === "true") return;
            trigger.dataset.authBound = "true";
            trigger.addEventListener("click", (event) => {
                if (event.defaultPrevented) return;
                event.preventDefault();
                const preferredMode = normalizeMode(trigger.dataset.authOpen);
                const action = String(trigger.dataset.authAction || "continue").trim() || "continue";
                const source = String(trigger.dataset.authSource || "ui-trigger").trim() || "ui-trigger";
                if (preferredMode === "signup") {
                    this.openSignUp({ action, source });
                    return;
                }
                this.openSignIn({ action, source });
            });
        });
    }

    async isAuthenticated() {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            return !!session?.user;
        } catch (error) {
            console.error("Unable to resolve auth session:", error);
            return false;
        }
    }

    setupDedicatedAuthPage() {
        const appPath = normalizeAuthRoutePath(getCurrentAppPath());
        if (!DEDICATED_AUTH_ROUTES.has(appPath)) {
            this.pageRoot = null;
            return;
        }

        const pageRoot = document.getElementById("auth-page-root");
        if (!pageRoot) return;

        this.pageRoot = pageRoot;
        this.bindDedicatedPageActionHandlers();
        const mode = getRouteDefaultMode(appPath);

        this.pageState = {
            step: "entry",
            mode,
            email: ""
        };

        this.applyAuthPrefillFromUrl();

        void this.initializeDedicatedAuthPageFlow();
    }

    bindDedicatedPageActionHandlers() {
        if (!this.pageRoot || this.pageRoot.dataset.authActionsBound === "true") return;
        this.pageRoot.dataset.authActionsBound = "true";

        this.pageRoot.addEventListener("click", (event) => {
            const button = event.target.closest("button[data-action]");
            if (!button) return;

            const action = String(button.dataset.action || "").trim();
            if (action === "auth-switch-mode") {
                this.switchPageMode();
                return;
            }
            if (action === "auth-back-entry") {
                this.pageState.step = "entry";
                this.renderDedicatedAuthPage();
                return;
            }
            if (action === "auth-change-email") {
                this.pageState.step = "entry";
                this.renderDedicatedAuthPage();
                return;
            }
            if (action === "auth-oauth-google") {
                this.handleOAuthLogin("google", { isModal: false });
                return;
            }
            if (action === "auth-oauth-azure") {
                this.handleOAuthLogin("azure", { isModal: false });
                return;
            }
            if (action === "auth-forgot-password") {
                this.handleForgotPasswordRequest({ isModal: false });
            }
        });
    }

    async initializeDedicatedAuthPageFlow() {
        const activatedRecovery = await this.tryActivatePasswordRecoveryFlow();
        if (activatedRecovery) return;
        this.renderDedicatedAuthPage();
    }

    getAuthFlowUrlContext() {
        const url = new URL(window.location.href);
        const hashParams = new URLSearchParams(String(url.hash || "").replace(/^#/, ""));

        const authIntent = String(url.searchParams.get("auth_intent") || "").trim().toLowerCase();
        const queryType = String(url.searchParams.get("type") || "").trim().toLowerCase();
        const hashType = String(hashParams.get("type") || "").trim().toLowerCase();
        const hasRecoveryIntent = authIntent === "password-reset" || queryType === "recovery" || hashType === "recovery";

        return { url, hashParams, hasRecoveryIntent };
    }

    applyAuthPrefillFromUrl() {
        const url = new URL(window.location.href);
        const prefillEmail = String(url.searchParams.get("auth_email") || "").trim();
        const prefillStep = String(url.searchParams.get("auth_step") || "").trim().toLowerCase();
        let shouldClean = false;

        if (isValidEmail(prefillEmail)) {
            this.pageState.email = prefillEmail;
        }

        if (prefillStep === "email-signup" || prefillStep === "email-signin") {
            this.pageState.step = prefillStep;
            this.pageState.mode = prefillStep === "email-signup" ? "signup" : "signin";
        }

        if (url.searchParams.has("auth_email")) {
            url.searchParams.delete("auth_email");
            shouldClean = true;
        }
        if (url.searchParams.has("auth_step")) {
            url.searchParams.delete("auth_step");
            shouldClean = true;
        }

        if (!shouldClean) return;
        const nextUrl = `${url.pathname}${url.search}${url.hash}`;
        window.history.replaceState({}, "", nextUrl || url.pathname);
    }

    navigateToDedicatedAuthStep({ mode, email, step }) {
        const normalizedMode = normalizeMode(mode);
        const targetRoute = normalizedMode === "signup" ? "/register" : "/login";
        const params = new URLSearchParams();

        if (isValidEmail(email)) {
            params.set("auth_email", String(email).trim());
        }
        if (step === "email-signup" || step === "email-signin") {
            params.set("auth_step", step);
        }

        const query = params.toString();
        const targetPath = query ? `${targetRoute}?${query}` : targetRoute;

        if (window.router?.navigate) {
            window.router.navigate(targetPath);
            return;
        }

        window.location.href = withBase(targetPath);
    }

    clearProcessedAuthUrlState({ keepRecoveryIntent = true } = {}) {
        const { url } = this.getAuthFlowUrlContext();
        let shouldReplace = false;
        const paramsToClear = ["code", "type", "error", "error_code", "error_description", "token_hash"];

        paramsToClear.forEach((key) => {
            if (url.searchParams.has(key)) {
                url.searchParams.delete(key);
                shouldReplace = true;
            }
        });

        if (!keepRecoveryIntent && url.searchParams.has("auth_intent")) {
            url.searchParams.delete("auth_intent");
            shouldReplace = true;
        }

        if (url.hash) {
            url.hash = "";
            shouldReplace = true;
        }

        if (!shouldReplace) return;
        const nextUrl = `${url.pathname}${url.search}${url.hash}`;
        window.history.replaceState({}, "", nextUrl || url.pathname);
    }

    async tryActivatePasswordRecoveryFlow() {
        if (!this.pageRoot) return false;
        const { url, hashParams, hasRecoveryIntent } = this.getAuthFlowUrlContext();
        if (!hasRecoveryIntent) return false;

        try {
            const authCode = String(url.searchParams.get("code") || "").trim();
            if (authCode && typeof supabase.auth.exchangeCodeForSession === "function") {
                await supabase.auth.exchangeCodeForSession(authCode);
            }

            const accessToken = String(hashParams.get("access_token") || "").trim();
            const refreshToken = String(hashParams.get("refresh_token") || "").trim();
            if (accessToken && refreshToken) {
                await supabase.auth.setSession({
                    access_token: accessToken,
                    refresh_token: refreshToken
                });
            }
        } catch (error) {
            console.warn("Auth: password recovery session setup failed", error);
        } finally {
            this.clearProcessedAuthUrlState({ keepRecoveryIntent: true });
        }

        try {
            const { data: { session } } = await supabase.auth.getSession();
            const recoveryEmail = String(session?.user?.email || "").trim();

            if (!session?.user) {
                this.clearProcessedAuthUrlState({ keepRecoveryIntent: false });
                this.pageState = {
                    step: "entry",
                    mode: "signin",
                    email: ""
                };
                this.renderDedicatedAuthPage();
                const message = document.getElementById("auth-page-message");
                this.setInlineMessage(message, "This password reset link is invalid or expired. Request a new one.", "error");
                return true;
            }

            this.pageState = {
                step: "password-reset",
                mode: "signin",
                email: recoveryEmail
            };
            this.renderDedicatedAuthPage();
            return true;
        } catch (error) {
            console.warn("Auth: unable to confirm password recovery session", error);
            this.clearProcessedAuthUrlState({ keepRecoveryIntent: false });
            this.pageState = {
                step: "entry",
                mode: "signin",
                email: ""
            };
            this.renderDedicatedAuthPage();
            const message = document.getElementById("auth-page-message");
            this.setInlineMessage(message, "This password reset link is invalid or expired. Request a new one.", "error");
            return true;
        }
    }

    clearForgotPasswordCooldownTimer(rootId) {
        const timer = this.forgotPasswordCooldownTimers[rootId];
        if (!timer) return;
        window.clearInterval(timer);
        this.forgotPasswordCooldownTimers[rootId] = null;
    }

    getForgotPasswordButton(rootId) {
        const containerId = rootId === "auth-modal" ? "auth-modal-root" : "auth-page-root";
        const container = document.getElementById(containerId);
        if (!container) return null;
        return container.querySelector('[data-action="auth-forgot-password"]');
    }

    applyForgotPasswordCooldownState({ rootId, email }) {
        const refreshButtonState = () => {
            const forgotButton = this.getForgotPasswordButton(rootId);
            if (!forgotButton) {
                this.clearForgotPasswordCooldownTimer(rootId);
                return;
            }

            const inFlight = rootId === "auth-modal"
                ? this.modalRecoveryRequestInFlight
                : this.pageRecoveryRequestInFlight;
            const remainingMs = getPasswordRecoveryCooldownRemainingMs(email);

            if (inFlight) {
                forgotButton.disabled = true;
                forgotButton.textContent = FORGOT_PASSWORD_BUTTON_LABEL;
                return;
            }

            if (remainingMs > 0) {
                forgotButton.disabled = true;
                forgotButton.textContent = `Resend in ${formatCooldownTimer(remainingMs)}`;
                return;
            }

            forgotButton.disabled = false;
            forgotButton.textContent = FORGOT_PASSWORD_BUTTON_LABEL;
            this.clearForgotPasswordCooldownTimer(rootId);
        };

        this.clearForgotPasswordCooldownTimer(rootId);
        refreshButtonState();

        if (getPasswordRecoveryCooldownRemainingMs(email) > 0) {
            this.forgotPasswordCooldownTimers[rootId] = window.setInterval(refreshButtonState, 1000);
        }
    }

    renderDedicatedAuthPage() {
        if (!this.pageRoot) return;

        const mode = normalizeMode(this.pageState.mode);
        const { step, email } = this.pageState;

        if (step === "password-reset") {
            this.pageRoot.innerHTML = this.buildPasswordResetMarkup({
                rootId: "auth-page",
                email
            });
            this.bindPasswordResetHandlers();
            this.suppressMobileAuthInputAutofocus(this.pageRoot);
            return;
        }

        if (step === "entry") {
            this.pageRoot.innerHTML = this.buildEntryMarkup({
                mode,
                email,
                rootId: "auth-page"
            });
            this.bindEntryHandlers({ isModal: false });
            this.applyForgotPasswordCooldownState({ rootId: "auth-page", email });
            this.suppressMobileAuthInputAutofocus(this.pageRoot);
            return;
        }

        this.pageRoot.innerHTML = this.buildPasswordStepMarkup({
            mode,
            email,
            rootId: "auth-page"
        });
        this.bindPasswordHandlers({ isModal: false });
        this.applyForgotPasswordCooldownState({ rootId: "auth-page", email });
        this.suppressMobileAuthInputAutofocus(this.pageRoot);
    }

    suppressMobileAuthInputAutofocus(container) {
        if (!container || !isMobileViewport()) return;

        const blurFocusedAuthInput = () => {
            const activeElement = document.activeElement;
            if (!(activeElement instanceof HTMLElement)) return;
            if (!container.contains(activeElement)) return;
            if (!activeElement.matches("input, textarea, select")) return;
            activeElement.blur();
        };

        blurFocusedAuthInput();
        window.requestAnimationFrame(blurFocusedAuthInput);
        window.setTimeout(blurFocusedAuthInput, 40);
    }

    ensureModalExists() {
        let modal = document.getElementById(MODAL_ID);
        if (modal) return modal;

        const modalMarkup = `
            <div id="${MODAL_ID}" class="auth-modal hidden" aria-hidden="true">
                <div class="auth-modal-background" data-action="close-auth-modal"></div>
                <div class="auth-modal-content" role="dialog" aria-modal="true" aria-label="Log in or sign up">
                    <div class="auth-modal-body">
                        <div id="auth-modal-root" class="auth-modal-root"></div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML("beforeend", modalMarkup);
        modal = document.getElementById(MODAL_ID);

        const modalRoot = modal?.querySelector("#auth-modal-root");
        modalRoot?.addEventListener("click", (event) => {
            const button = event.target.closest("button[data-action]");
            if (!button) return;

            const action = button.dataset.action;
            if (action === "auth-switch-mode") {
                this.switchModalMode();
                return;
            }
            if (action === "auth-back-entry") {
                this.modalState.step = "entry";
                this.renderModal();
                return;
            }
            if (action === "auth-change-email") {
                this.modalState.step = "entry";
                this.renderModal();
                return;
            }
            if (action === "auth-oauth-google") {
                this.handleOAuthLogin("google", { isModal: true });
                return;
            }
            if (action === "auth-oauth-azure") {
                this.handleOAuthLogin("azure", { isModal: true });
                return;
            }
            if (action === "auth-forgot-password") {
                this.handleForgotPasswordRequest({ isModal: true });
                return;
            }
        });

        return modal;
    }

    openModal({ preferredMode = "signin", action = "continue", source = "unknown", onSuccess = null } = {}) {
        const mode = normalizeMode(preferredMode);
        this.activeContext = { action, source };
        this.onSuccessCallback = typeof onSuccess === "function" ? onSuccess : null;

        this.modalState = {
            step: "entry",
            mode,
            email: ""
        };

        const modal = this.ensureModalExists();
        this.renderModal();

        modal.classList.remove("hidden");
        modal.setAttribute("aria-hidden", "false");
        document.body.classList.add("auth-modal-open");
        this.currentModal = "unified";

        if (!isMobileViewport()) {
            window.setTimeout(() => {
                const input = modal.querySelector("#auth-modal-email");
                input?.focus({ preventScroll: true });
            }, 30);
        } else {
            this.suppressMobileAuthInputAutofocus(modal);
        }
    }

    renderModal() {
        const modal = this.ensureModalExists();
        const modalRoot = modal.querySelector("#auth-modal-root");
        if (!modalRoot) return;

        const mode = normalizeMode(this.modalState.mode);
        const { step, email } = this.modalState;

        if (step === "entry") {
            modalRoot.innerHTML = this.buildEntryMarkup({
                mode,
                email,
                rootId: "auth-modal",
                actionLabel: this.activeContext.action
            });
            this.bindEntryHandlers({ isModal: true });
            this.applyForgotPasswordCooldownState({ rootId: "auth-modal", email });
            this.suppressMobileAuthInputAutofocus(modalRoot);
            return;
        }

        modalRoot.innerHTML = this.buildPasswordStepMarkup({
            mode,
            email,
            rootId: "auth-modal",
            actionLabel: this.activeContext.action
        });
        this.bindPasswordHandlers({ isModal: true });
        this.applyForgotPasswordCooldownState({ rootId: "auth-modal", email });
        this.suppressMobileAuthInputAutofocus(modalRoot);
    }

    normalizeSubtitleAction(actionLabel) {
        const rawAction = String(actionLabel || "").trim().replace(/\s+/g, " ");
        if (!rawAction) return "";

        const normalized = rawAction.toLowerCase().replace(/[.!?]+$/g, "");
        const genericActions = new Set([
            "continue",
            "proceed",
            "next",
            "get started",
            "log in",
            "login",
            "sign in",
            "sign up",
            "register",
            "registered"
        ]);

        if (genericActions.has(normalized)) return "";
        return rawAction.replace(/[.!?\s]+$/g, "");
    }

    getEntrySubtitle({ mode, actionLabel }) {
        const rawAction = String(actionLabel || "").trim().replace(/\s+/g, " ");
        const normalizedAction = rawAction.toLowerCase().replace(/[.!?]+$/g, "");

        if (mode === "signup" && normalizedAction === "get started") {
            return "Create your account with any email address to access all the functionalities for free.";
        }

        const contextualAction = this.normalizeSubtitleAction(actionLabel);
        if (contextualAction) {
            return `Continue to ${contextualAction}.`;
        }

        if (mode === "signup") {
            return "Create your account with any email address to access all the functionalities for free.";
        }

        return "Use any email address to log in or create an account.";
    }

    getPasswordSubtitle({ mode, actionLabel }) {
        const contextualAction = this.normalizeSubtitleAction(actionLabel);
        if (mode === "signup") {
            if (contextualAction) {
                return `Sign up to ${contextualAction}.`;
            }
            return "Create a password to finish setting up your account.";
        }

        if (contextualAction) {
            return `Log in to ${contextualAction}.`;
        }

        return "Enter your password to continue.";
    }

    buildEntryMarkup({ mode, email, rootId, actionLabel = "continue" }) {
        const title = "Log in or sign up";
        const subtitle = this.getEntrySubtitle({ mode, actionLabel });
        const closeButtonMarkup = rootId === "auth-modal"
            ? `<button type="button" class="auth-close-btn" data-action="close-auth-modal" aria-label="Close authentication dialog"></button>`
            : "";

        return `
            <div class="auth-unified-shell" data-auth-root="${rootId}" data-auth-step="entry" data-auth-mode="${mode}">
                <div class="auth-unified-title-row">
                    <h2 class="auth-unified-title">${title}</h2>
                    ${closeButtonMarkup}
                </div>
                <p class="auth-unified-subtitle">${subtitle}</p>

                <div class="auth-provider-list" role="group" aria-label="Social sign in options">
                    <button type="button" class="auth-provider-btn" data-action="auth-oauth-google">
                        <span class="auth-provider-icon auth-provider-icon--google" aria-hidden="true"></span>
                        <span>Continue with Google</span>
                    </button>
                    <button type="button" class="auth-provider-btn" data-action="auth-oauth-azure">
                        <span class="auth-provider-icon auth-provider-icon--azure" aria-hidden="true"></span>
                        <span>Continue with Outlook</span>
                    </button>
                </div>

                <div class="auth-divider" role="separator" aria-label="or"><span>OR</span></div>

                <form class="auth-email-form" id="${rootId}-entry-form" novalidate>
                    <label class="auth-field-wrap">
                        <input type="email" id="${rootId}-email" class="auth-field-input auth-field-input--email-entry" aria-label="Email address" placeholder=" " autocomplete="email" value="${escapeHtml(email || "")}" required>
                        <span class="auth-field-label">Email address</span>
                    </label>
                    <button type="submit" class="auth-provider-btn" id="${rootId}-entry-submit">Continue with email</button>
                </form>

                ${createInlineMessageMarkup(`${rootId}-message`)}
            </div>
        `;
    }

    buildPasswordStepMarkup({ mode, email, rootId, actionLabel = "continue" }) {
        const isSignUp = mode === "signup";
        const title = isSignUp ? "Sign up" : "Log in";
        const subtitle = this.getPasswordSubtitle({ mode, actionLabel });
        const closeButtonMarkup = rootId === "auth-modal"
            ? `<button type="button" class="auth-close-btn" data-action="close-auth-modal" aria-label="Close authentication dialog"></button>`
            : "";

        return `
            <div class="auth-unified-shell" data-auth-root="${rootId}" data-auth-step="${isSignUp ? "email-signup" : "email-signin"}" data-auth-mode="${mode}">
                <div class="auth-unified-title-row">
                    <h2 class="auth-unified-title">${title}</h2>
                    ${closeButtonMarkup}
                </div>
                <p class="auth-unified-subtitle">${subtitle}</p>
                <div class="auth-field-wrap auth-field-wrap--readonly auth-field-wrap--with-action">
                    <input
                        type="email"
                        class="auth-field-input auth-field-input--email-entry auth-email-chip-input"
                        id="${rootId}-email-readonly"
                        value="${escapeHtml(email)}"
                        aria-label="Email address"
                        placeholder=" "
                        readonly
                        tabindex="-1"
                    >
                    <span class="auth-field-label">Email address</span>
                    <button type="button" class="auth-field-inline-action" data-action="auth-change-email">Change</button>
                </div>

                <form class="auth-email-form" id="${rootId}-password-form" novalidate>
                    <label class="auth-field-wrap ${isSignUp ? "" : "auth-field-wrap--with-password-toggle"}">
                        <input type="password" id="${rootId}-password" class="auth-field-input auth-field-input--email-entry" aria-label="Password" placeholder=" " autocomplete="${isSignUp ? "new-password" : "current-password"}" minlength="${isSignUp ? "12" : "1"}" required>
                        <span class="auth-field-label">${isSignUp ? "Create password" : "Password"}</span>
                        ${isSignUp ? "" : `<button type="button" id="${rootId}-password-toggle" class="auth-password-visibility-toggle" aria-label="Show password" aria-controls="${rootId}-password" aria-pressed="false"></button>`}
                    </label>
                    ${isSignUp ? `
                        <label class="auth-field-wrap">
                            <input type="password" id="${rootId}-password-confirm" class="auth-field-input auth-field-input--email-entry" aria-label="Confirm password" placeholder=" " autocomplete="new-password" minlength="12" required>
                            <span class="auth-field-label">Confirm password</span>
                        </label>
                    ` : ""}
                    ${isSignUp ? "" : `
                        <div class="auth-password-help">
                            <button type="button" class="auth-link-btn auth-forgot-password-btn" data-action="auth-forgot-password">Forgot password?</button>
                        </div>
                    `}
                    <button type="submit" class="auth-primary-btn" id="${rootId}-password-submit">${isSignUp ? "Create account" : "Log in"}</button>
                </form>

                ${createInlineMessageMarkup(`${rootId}-message`)}
            </div>
        `;
    }

    buildPasswordResetMarkup({ rootId, email }) {
        return `
            <div class="auth-unified-shell" data-auth-root="${rootId}" data-auth-step="password-reset" data-auth-mode="signin">
                <h2 class="auth-unified-title">Reset your password</h2>
                <p class="auth-unified-subtitle">Choose a new password for ${escapeHtml(email || "your account")}.</p>

                <form class="auth-email-form" id="${rootId}-reset-form" novalidate>
                    <label class="auth-field-wrap">
                        <input type="password" id="${rootId}-reset-password" class="auth-field-input auth-field-input--email-entry" aria-label="New password" placeholder=" " autocomplete="new-password" minlength="12" required>
                        <span class="auth-field-label">New password</span>
                    </label>
                    <label class="auth-field-wrap">
                        <input type="password" id="${rootId}-reset-password-confirm" class="auth-field-input auth-field-input--email-entry" aria-label="Confirm new password" placeholder=" " autocomplete="new-password" minlength="12" required>
                        <span class="auth-field-label">Confirm new password</span>
                    </label>
                    <button type="submit" class="auth-primary-btn" id="${rootId}-reset-submit">Update password</button>
                </form>

                ${createInlineMessageMarkup(`${rootId}-message`)}
            </div>
        `;
    }

    async lookupEmailSignInMethods(email) {
        if (!this.emailSignInMethodLookupAvailable) return null;

        const normalizedEmail = normalizeEmailForStorage(email);
        if (!isValidEmail(normalizedEmail)) return null;

        try {
            const { data, error } = await supabase.rpc(EMAIL_SIGNIN_METHOD_LOOKUP_RPC, {
                lookup_email: normalizedEmail
            });

            if (error) {
                const message = String(error?.message || "").toLowerCase();
                if (error?.code === "42883" || message.includes("does not exist")) {
                    this.emailSignInMethodLookupAvailable = false;
                }
                return null;
            }

            const row = Array.isArray(data) ? data[0] : data;
            if (!row || typeof row !== "object") return null;

            const hasAccount = Boolean(row.has_account);
            const hasPassword = Boolean(row.has_password);
            const primaryOAuthProvider = normalizeOAuthProviderName(row.primary_oauth_provider);
            const oauthProviders = Array.from(new Set(
                (Array.isArray(row.oauth_providers) ? row.oauth_providers : [])
                    .map((provider) => normalizeOAuthProviderName(provider))
                    .filter(Boolean)
            ));

            return { hasAccount, hasPassword, primaryOAuthProvider, oauthProviders };
        } catch (_) {
            return null;
        }
    }

    getPreferredOAuthProviderFromLookup(lookupResult) {
        if (!lookupResult || typeof lookupResult !== "object") return "";

        const candidates = [];
        if (lookupResult.primaryOAuthProvider) {
            candidates.push(lookupResult.primaryOAuthProvider);
        }

        const oauthProviders = Array.isArray(lookupResult.oauthProviders) ? lookupResult.oauthProviders : [];
        oauthProviders.forEach((provider) => {
            const normalized = normalizeOAuthProviderName(provider);
            if (normalized) {
                candidates.push(normalized);
            }
        });

        for (const provider of candidates) {
            if (isSupportedAuthOAuthProvider(provider)) {
                return provider;
            }
        }

        return "";
    }

    bindEntryHandlers({ isModal }) {
        const rootId = isModal ? "auth-modal" : "auth-page";
        const form = document.getElementById(`${rootId}-entry-form`);
        const message = document.getElementById(`${rootId}-message`);

        if (!form || form.dataset.authBound === "true") return;
        form.dataset.authBound = "true";

        const emailInput = document.getElementById(`${rootId}-email`);
        emailInput?.addEventListener("input", () => {
            clearFieldError(emailInput, { root: form });
            this.setInlineMessage(message, "", "");
        });

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (isModal ? this.modalSubmissionInFlight : this.pageSubmissionInFlight) return;

            const emailInput = document.getElementById(`${rootId}-email`);
            const submitButton = document.getElementById(`${rootId}-entry-submit`);
            const email = String(emailInput?.value || "").trim();

            clearFieldErrors(form);
            this.setInlineMessage(message, "", "");
            if (!email) {
                setFieldError(emailInput, "Email is required.", {
                    root: form,
                    anchor: emailInput?.closest(".auth-field-wrap")
                });
                return;
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                setFieldError(emailInput, "Please enter a valid email address.", {
                    root: form,
                    anchor: emailInput?.closest(".auth-field-wrap")
                });
                return;
            }

            if (submitButton) submitButton.disabled = true;

            try {
                const state = isModal ? this.modalState : this.pageState;
                const currentMode = normalizeMode(state.mode);
                const lookupResult = await this.lookupEmailSignInMethods(email);

                if (lookupResult?.hasAccount && !lookupResult.hasPassword) {
                    const oauthProvider = this.getPreferredOAuthProviderFromLookup(lookupResult);
                    if (oauthProvider) {
                        const providerName = getOAuthProviderDisplayName(oauthProvider);
                        this.setInlineMessage(message, `This account uses ${providerName}. Redirecting to ${providerName} sign-in...`, "success");
                        await this.handleOAuthLogin(oauthProvider, { isModal });
                        return;
                    }
                    this.setInlineMessage(message, "This account does not use email/password. Continue with a social sign-in provider.", "error");
                    return;
                }

                const hasKnownNoAccount = lookupResult?.hasAccount === false;
                const hasPasswordMethod = Boolean(lookupResult?.hasAccount && lookupResult.hasPassword);
                const nextMode = hasKnownNoAccount
                    ? "signup"
                    : (hasPasswordMethod ? "signin" : currentMode);
                const nextStep = nextMode === "signup" ? "email-signup" : "email-signin";

                if (isModal) {
                    if (nextMode === "signup" && !hasKnownNoAccount) {
                        this.closeCurrentModal();
                        this.navigateToDedicatedAuthStep({
                            mode: "signup",
                            email,
                            step: "email-signup"
                        });
                        return;
                    }

                    this.modalState.mode = nextMode;
                    this.modalState.email = email;
                    this.modalState.step = nextStep;
                    this.renderModal();
                } else {
                    this.pageState.mode = nextMode;
                    this.pageState.email = email;
                    this.pageState.step = nextStep;
                    this.renderDedicatedAuthPage();
                }
            } finally {
                if (submitButton && submitButton.isConnected) {
                    submitButton.disabled = false;
                }
            }
        });
    }

    bindPasswordHandlers({ isModal }) {
        const rootId = isModal ? "auth-modal" : "auth-page";
        const form = document.getElementById(`${rootId}-password-form`);
        const message = document.getElementById(`${rootId}-message`);

        if (!form || form.dataset.authBound === "true") return;
        form.dataset.authBound = "true";

        const passwordInput = document.getElementById(`${rootId}-password`);
        const confirmInput = document.getElementById(`${rootId}-password-confirm`);
        const passwordToggle = document.getElementById(`${rootId}-password-toggle`);
        const syncPasswordToggleState = () => {
            if (!passwordToggle || !passwordInput) return;
            const isVisible = passwordInput.type === "text";
            passwordToggle.classList.toggle("is-visible", isVisible);
            passwordToggle.setAttribute("aria-label", isVisible ? "Hide password" : "Show password");
            passwordToggle.setAttribute("aria-pressed", isVisible ? "true" : "false");
        };
        if (passwordToggle && passwordInput) {
            syncPasswordToggleState();
            passwordToggle.addEventListener("click", (event) => {
                event.preventDefault();
                const isVisible = passwordInput.type === "text";
                passwordInput.type = isVisible ? "password" : "text";
                syncPasswordToggleState();
                passwordInput.focus({ preventScroll: true });
            });
        }
        passwordInput?.addEventListener("input", () => {
            clearFieldError(passwordInput, { root: form });
            this.setInlineMessage(message, "", "");
        });
        confirmInput?.addEventListener("input", () => {
            clearFieldError(confirmInput, { root: form });
            this.setInlineMessage(message, "", "");
        });

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (isModal ? this.modalSubmissionInFlight : this.pageSubmissionInFlight) return;

            const state = isModal ? this.modalState : this.pageState;
            const mode = normalizeMode(state.mode);
            const email = String(state.email || "").trim();
            const passwordInput = document.getElementById(`${rootId}-password`);
            const confirmInput = document.getElementById(`${rootId}-password-confirm`);
            const submitButton = document.getElementById(`${rootId}-password-submit`);
            const password = String(passwordInput?.value || "");
            const confirmPassword = String(confirmInput?.value || "");

            clearFieldErrors(form);
            this.setInlineMessage(message, "", "");

            if (!password) {
                setFieldError(passwordInput, "Password is required.", {
                    root: form,
                    anchor: passwordInput?.closest(".auth-field-wrap")
                });
                return;
            }

            if (mode === "signup") {
                if (password.length < 12) {
                    setFieldError(passwordInput, "Password must be at least 12 characters long.", {
                        root: form,
                        anchor: passwordInput?.closest(".auth-field-wrap")
                    });
                    return;
                }
                if (!confirmPassword) {
                    setFieldError(confirmInput, "Please confirm your password.", {
                        root: form,
                        anchor: confirmInput?.closest(".auth-field-wrap")
                    });
                    return;
                }
                if (password !== confirmPassword) {
                    setFieldError(confirmInput, "Passwords do not match.", {
                        root: form,
                        anchor: confirmInput?.closest(".auth-field-wrap")
                    });
                    return;
                }
            }

            if (submitButton) submitButton.disabled = true;
            if (isModal) this.modalSubmissionInFlight = true;
            else this.pageSubmissionInFlight = true;

            try {
                if (mode === "signup") {
                    await this.handleEmailSignUp({ email, password, messageTarget: message, isModal, rootId });
                } else {
                    await this.handleEmailSignIn({ email, password, messageTarget: message, isModal, rootId });
                }
            } finally {
                if (submitButton) submitButton.disabled = false;
                if (isModal) this.modalSubmissionInFlight = false;
                else this.pageSubmissionInFlight = false;
            }
        });
    }

    async handleForgotPasswordRequest({ isModal }) {
        const rootId = isModal ? "auth-modal" : "auth-page";
        const state = isModal ? this.modalState : this.pageState;
        const email = String(state?.email || "").trim().toLowerCase();
        const message = document.getElementById(`${rootId}-message`);

        if (!isValidEmail(email)) {
            this.setInlineMessage(message, "Enter your email first, then try password recovery.", "error");
            return;
        }

        const existingCooldownMs = getPasswordRecoveryCooldownRemainingMs(email);
        if (existingCooldownMs > 0) {
            this.setInlineMessage(message, `Please wait ${formatCooldownTimer(existingCooldownMs)} before requesting another reset email.`, "error");
            this.applyForgotPasswordCooldownState({ rootId, email });
            return;
        }

        if (isModal ? this.modalRecoveryRequestInFlight : this.pageRecoveryRequestInFlight) return;
        if (isModal) this.modalRecoveryRequestInFlight = true;
        else this.pageRecoveryRequestInFlight = true;
        this.applyForgotPasswordCooldownState({ rootId, email });

        try {
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: getPasswordRecoveryRedirectTo()
            });

            if (error) {
                if (isLikelyNetworkError(error)) {
                    this.setInlineMessage(message, "Could not reach the server. Please try again.", "error");
                    return;
                }
                this.setInlineMessage(message, "Could not send a reset email right now. Please try again shortly.", "error");
                return;
            }

            // Never reveal whether an email is registered.
            markPasswordRecoverySent(email);
            this.setInlineMessage(message, "If an account exists for this email, a password reset link has been sent.", "success");
        } catch (error) {
            if (isLikelyNetworkError(error)) {
                this.setInlineMessage(message, "Could not reach the server. Please try again.", "error");
                return;
            }
            this.setInlineMessage(message, "Could not send a reset email right now. Please try again shortly.", "error");
        } finally {
            if (isModal) this.modalRecoveryRequestInFlight = false;
            else this.pageRecoveryRequestInFlight = false;
            this.applyForgotPasswordCooldownState({ rootId, email });
        }
    }

    bindPasswordResetHandlers() {
        const rootId = "auth-page";
        const form = document.getElementById(`${rootId}-reset-form`);
        const message = document.getElementById(`${rootId}-message`);

        if (!form || form.dataset.authBound === "true") return;
        form.dataset.authBound = "true";

        const passwordInput = document.getElementById(`${rootId}-reset-password`);
        const confirmInput = document.getElementById(`${rootId}-reset-password-confirm`);
        passwordInput?.addEventListener("input", () => {
            clearFieldError(passwordInput, { root: form });
            this.setInlineMessage(message, "", "");
        });
        confirmInput?.addEventListener("input", () => {
            clearFieldError(confirmInput, { root: form });
            this.setInlineMessage(message, "", "");
        });

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (this.pageSubmissionInFlight) return;

            const submitButton = document.getElementById(`${rootId}-reset-submit`);
            const password = String(passwordInput?.value || "");
            const confirmPassword = String(confirmInput?.value || "");

            clearFieldErrors(form);
            this.setInlineMessage(message, "", "");

            if (!password) {
                setFieldError(passwordInput, "New password is required.", {
                    root: form,
                    anchor: passwordInput?.closest(".auth-field-wrap")
                });
                return;
            }
            if (password.length < 12) {
                setFieldError(passwordInput, "Password must be at least 12 characters long.", {
                    root: form,
                    anchor: passwordInput?.closest(".auth-field-wrap")
                });
                return;
            }
            if (!confirmPassword) {
                setFieldError(confirmInput, "Please confirm your new password.", {
                    root: form,
                    anchor: confirmInput?.closest(".auth-field-wrap")
                });
                return;
            }
            if (password !== confirmPassword) {
                setFieldError(confirmInput, "Passwords do not match.", {
                    root: form,
                    anchor: confirmInput?.closest(".auth-field-wrap")
                });
                return;
            }

            if (submitButton) submitButton.disabled = true;
            this.pageSubmissionInFlight = true;

            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session?.user) {
                    this.setInlineMessage(message, "Your reset session has expired. Request a new reset link.", "error");
                    return;
                }

                const { error } = await supabase.auth.updateUser({ password });
                if (error) {
                    this.setInlineMessage(message, getAuthErrorMessage(error, "Could not update password right now."), "error");
                    return;
                }

                this.clearProcessedAuthUrlState({ keepRecoveryIntent: false });
                this.setInlineMessage(message, "Password updated successfully. Redirecting...", "success");
                window.setTimeout(() => {
                    navigateAfterAuthSuccess(AUTH_PASSWORD_UPDATED_TOAST_MESSAGE);
                }, 280);
            } catch (error) {
                this.setInlineMessage(message, getAuthErrorMessage(error, "Could not update password right now."), "error");
            } finally {
                this.pageSubmissionInFlight = false;
                if (submitButton) submitButton.disabled = false;
            }
        });
    }

    async handleEmailSignIn({ email, password, messageTarget, isModal, rootId }) {
        try {
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) {
                if (isEmailNotConfirmedError(error)) {
                    this.setInlineMessage(messageTarget, "Please verify your email before logging in.", "error");
                    return;
                }
                if (isInvalidCredentialsError(error)) {
                    const passwordInput = document.getElementById(`${rootId}-password`);
                    const form = document.getElementById(`${rootId}-password-form`);
                    setFieldError(passwordInput, "Invalid email or password. Please try again.", {
                        root: form || document,
                        anchor: passwordInput?.closest(".auth-field-wrap")
                    });
                    return;
                }
                this.setInlineMessage(messageTarget, getAuthErrorMessage(error, "Could not sign in right now."), "error");
                return;
            }

            await this.handleSuccessfulAuthentication({ isModal });
        } catch (error) {
            this.setInlineMessage(messageTarget, getAuthErrorMessage(error, "Could not sign in right now."), "error");
        }
    }

    async handleEmailSignUp({ email, password, messageTarget, isModal }) {
        try {
            const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    emailRedirectTo: getAuthCallbackRedirectTo()
                }
            });

            if (error) {
                if (isUserAlreadyRegisteredError(error)) {
                    this.setInlineMessage(messageTarget, "This email is already registered. Try logging in instead.", "error");
                    return;
                }
                this.setInlineMessage(messageTarget, getAuthErrorMessage(error, "Could not create your account right now."), "error");
                return;
            }

            const identities = Array.isArray(data?.user?.identities) ? data.user.identities : [];
            const createdNewAccount = identities.length > 0;

            if (createdNewAccount && !data?.session) {
                this.setInlineMessage(messageTarget, "Account created. Check your email to verify your account.", "success");
                if (isModal) {
                    this.modalState.mode = "signin";
                } else {
                    this.pageState.mode = "signin";
                }
                return;
            }

            if (data?.session) {
                await this.handleSuccessfulAuthentication({ isModal });
                return;
            }

            this.setInlineMessage(messageTarget, "Account created. Check your email to verify your account.", "success");
        } catch (error) {
            this.setInlineMessage(messageTarget, getAuthErrorMessage(error, "Could not create your account right now."), "error");
        }
    }

    async handleOAuthLogin(provider, { isModal }) {
        const rootId = isModal ? "auth-modal" : "auth-page";
        const message = document.getElementById(`${rootId}-message`);
        const buttons = Array.from(document.querySelectorAll(`#${rootId === "auth-modal" ? "auth-modal-root" : "auth-page-root"} .auth-provider-btn`));
        const emailInput = document.getElementById(`${rootId}-email`);
        const expectedEmail = String(emailInput?.value || "").trim().toLowerCase();

        if (isValidEmail(expectedEmail)) {
            setExpectedOAuthEmail(expectedEmail);
        } else {
            clearExpectedOAuthEmail();
        }

        buttons.forEach((button) => {
            button.disabled = true;
        });

        this.setInlineMessage(message, "", "");

        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider,
                options: getOAuthOptions(provider)
            });

            if (error) {
                const providerName = getOAuthProviderDisplayName(provider);
                const normalized = String(error.message || "").toLowerCase();
                if (normalized.includes("provider is not enabled") || normalized.includes("unsupported provider")) {
                    this.setInlineMessage(message, `${providerName} sign-in is not enabled yet. Enable this provider in Supabase Auth settings.`, "error");
                    clearExpectedOAuthEmail();
                } else if (isOAuthEmailMismatchError(error)) {
                    this.setInlineMessage(message, "This OAuth email does not match your account email. Use the same email or sign in with password.", "error");
                    showAppToast("OAuth email mismatch. Please use your account email.", 3000, "error");
                    clearExpectedOAuthEmail();
                } else {
                    this.setInlineMessage(message, getAuthErrorMessage(error, `Could not continue with ${providerName}.`), "error");
                    clearExpectedOAuthEmail();
                }
            }
        } catch (error) {
            const providerName = getOAuthProviderDisplayName(provider);
            this.setInlineMessage(message, getAuthErrorMessage(error, `Could not continue with ${providerName}.`), "error");
            if (isOAuthEmailMismatchError(error)) {
                showAppToast("OAuth email mismatch. Please use your account email.", 3000, "error");
            }
            clearExpectedOAuthEmail();
        } finally {
            buttons.forEach((button) => {
                button.disabled = false;
            });
        }
    }

    setInlineMessage(target, text, kind = "") {
        if (!target) return;
        const normalized = String(text || "").trim();
        target.textContent = normalized;
        target.classList.remove("error", "success", "visible");
        if (!normalized) return;
        if (kind === "error" || kind === "success") {
            target.classList.add(kind);
        }
        target.classList.add("visible");
    }

    async handleSuccessfulAuthentication({ isModal }) {
        queueAuthSuccessToast();

        const callback = this.onSuccessCallback;
        this.onSuccessCallback = null;

        if (isModal) {
            this.closeCurrentModal({ clearCallback: false });
        }

        if (typeof callback === "function") {
            try {
                await callback();
            } catch (error) {
                console.error("Auth success callback failed:", error);
            }
            return;
        }

        const appPath = normalizeAuthRoutePath(getCurrentAppPath());
        if (DEDICATED_AUTH_ROUTES.has(appPath)) {
            navigateAfterAuthSuccess();
            return;
        }

        if (window.router?.loadPage) {
            flushPendingAuthSuccessToast();
            window.router.loadPage(window.router.currentPath || appPath);
            return;
        }

        window.location.reload();
    }

    switchModalMode() {
        this.modalState.mode = this.modalState.mode === "signup" ? "signin" : "signup";
        this.modalState.step = "entry";
        this.renderModal();
    }

    switchPageMode() {
        this.pageState.mode = this.pageState.mode === "signup" ? "signin" : "signup";
        this.pageState.step = "entry";
        this.renderDedicatedAuthPage();
    }

    openSignIn({ action = "continue", source = "unknown", onSuccess = null } = {}) {
        this.openModal({ preferredMode: "signin", action, source, onSuccess });
    }

    openSignUp({ action = "continue", source = "unknown", onSuccess = null } = {}) {
        this.openModal({ preferredMode: "signup", action, source, onSuccess });
    }

    showLoginModal(action = "continue") {
        this.openSignIn({ action, source: "legacy-showLoginModal" });
    }

    showRegisterModal(action = "continue") {
        this.openSignUp({ action, source: "legacy-showRegisterModal" });
    }

    switchToRegister() {
        if (this.currentModal) {
            this.modalState.mode = "signup";
            this.modalState.step = "entry";
            this.renderModal();
            return;
        }
        this.switchPageMode();
    }

    switchToLogin() {
        if (this.currentModal) {
            this.modalState.mode = "signin";
            this.modalState.step = "entry";
            this.renderModal();
            return;
        }
        this.switchPageMode();
    }

    async requireAuth(action = "continue", onSuccess = null, options = {}) {
        const isAuthenticated = await this.isAuthenticated();
        if (isAuthenticated) {
            if (typeof onSuccess === "function") {
                await onSuccess();
            }
            return true;
        }

        const preferredMode = normalizeMode(options?.preferredMode || "signin");
        const source = String(options?.source || "requireAuth").trim() || "requireAuth";
        this.openModal({ preferredMode, action, source, onSuccess });
        return false;
    }

    closeCurrentModal({ clearCallback = true } = {}) {
        const modal = document.getElementById(MODAL_ID);
        if (!modal) return;

        modal.classList.add("hidden");
        modal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("auth-modal-open");
        this.currentModal = null;
        this.clearForgotPasswordCooldownTimer("auth-modal");

        if (clearCallback) {
            this.onSuccessCallback = null;
        }
    }
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

let authManagerInstance = null;

function initializeAuth() {
    initializeGlobalFieldErrorUI();
    flushPendingAuthSuccessToast();

    if (!authManagerInstance) {
        authManagerInstance = new UnifiedAuthManager();
    } else {
        authManagerInstance.setupDedicatedAuthPage();
        authManagerInstance.bindGlobalAuthTriggers();
        authManagerInstance.navTeaser.bindTargets();
    }

    window.authManager = authManagerInstance;
    window.requireAuth = (action, onSuccess, options) => authManagerInstance.requireAuth(action, onSuccess, options);
    window.openAuthModal = (preferredMode = "signin", options = {}) => {
        if (normalizeMode(preferredMode) === "signup") {
            authManagerInstance.openSignUp(options);
        } else {
            authManagerInstance.openSignIn(options);
        }
    };
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeAuth);
} else {
    initializeAuth();
}

document.addEventListener("pageLoaded", initializeAuth);

export { initializeAuth, UnifiedAuthManager };
window.initializeAuth = initializeAuth;
