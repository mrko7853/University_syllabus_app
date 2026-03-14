import { supabase } from "../supabase.js";
import { withBase } from "./path-utils.js";

const AUTH_SUCCESS_TOAST_KEY = 'ila_auth_success_toast';
const AUTH_SUCCESS_TOAST_MESSAGE = 'Login successful.';

function queueAuthSuccessToast(message = AUTH_SUCCESS_TOAST_MESSAGE) {
    try {
        window.sessionStorage.setItem(AUTH_SUCCESS_TOAST_KEY, String(message || AUTH_SUCCESS_TOAST_MESSAGE));
    } catch (_) { }
}

function consumeAuthSuccessToast() {
    try {
        const message = window.sessionStorage.getItem(AUTH_SUCCESS_TOAST_KEY);
        if (!message) return '';
        window.sessionStorage.removeItem(AUTH_SUCCESS_TOAST_KEY);
        return message;
    } catch (_) {
        return '';
    }
}

function showAppToast(message, durationMs = 2200) {
    const normalized = String(message || '').trim();
    if (!normalized) return;

    const existingToast = document.getElementById('link-copied-notification');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.id = 'link-copied-notification';
    toast.textContent = normalized;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    window.setTimeout(() => {
        toast.classList.remove('show');
        window.setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
    }, durationMs);
}

function flushPendingAuthSuccessToast() {
    const pendingMessage = consumeAuthSuccessToast();
    if (pendingMessage) {
        showAppToast(pendingMessage);
    }
}

function getEmailRedirectTo() {
    return `${window.location.origin}${withBase('/auth/callback')}`;
}

function navigateAfterAuthSuccess() {
    queueAuthSuccessToast();
    if (window.router) {
        window.router.navigate('/dashboard');
        return;
    }
    window.location.href = withBase('/');
}

function getAuthErrorMessage(error, fallback = 'Authentication failed. Please try again.') {
    const message = String(error?.message || '').trim();
    return message || fallback;
}

function isInvalidCredentialsError(error) {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('invalid login credentials');
}

function isEmailNotConfirmedError(error) {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('email not confirmed');
}

function isUserAlreadyRegisteredError(error) {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('user already registered');
}

function setInlineMessage(target, text, kind = 'error') {
    if (!target) return;
    target.textContent = text;
    target.className = kind;
}

async function handleUnifiedPageAuth(email, password, messageDisplay) {
    const normalizedEmail = String(email || '').trim();
    const normalizedPassword = String(password || '');

    const { error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: normalizedPassword
    });

    if (!signInError) {
        navigateAfterAuthSuccess();
        return;
    }

    if (isEmailNotConfirmedError(signInError)) {
        setInlineMessage(messageDisplay, 'Please check your email and confirm your account before logging in.', 'error');
        return;
    }

    if (!isInvalidCredentialsError(signInError)) {
        setInlineMessage(messageDisplay, getAuthErrorMessage(signInError, 'Could not sign in right now.'), 'error');
        return;
    }

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password: normalizedPassword,
        options: {
            emailRedirectTo: getEmailRedirectTo()
        }
    });

    if (signUpError) {
        if (isUserAlreadyRegisteredError(signUpError)) {
            setInlineMessage(messageDisplay, 'Invalid email or password. Please try again.', 'error');
            return;
        }
        setInlineMessage(messageDisplay, getAuthErrorMessage(signUpError, 'Could not create your account right now.'), 'error');
        return;
    }

    const identities = Array.isArray(signUpData?.user?.identities) ? signUpData.user.identities : [];
    const createdNewAccount = identities.length > 0;

    if (createdNewAccount) {
        setInlineMessage(messageDisplay, 'Account created. Please check your email to verify your account.', 'success');
        return;
    }

    // Existing account can return an obfuscated sign-up response.
    const { error: retrySignInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: normalizedPassword
    });

    if (!retrySignInError) {
        navigateAfterAuthSuccess();
        return;
    }

    if (isEmailNotConfirmedError(retrySignInError)) {
        setInlineMessage(messageDisplay, 'Please check your email and confirm your account before logging in.', 'error');
        return;
    }

    setInlineMessage(messageDisplay, 'Invalid email or password. Please try again.', 'error');
}

// Setup auth form handlers that work with the router
function setupAuthHandlers() {
    const pageLoginForm = document.getElementById("login-form");
    const registerForm = document.getElementById("register-form");

    if (pageLoginForm && pageLoginForm.dataset.authBound !== 'true') {
        pageLoginForm.dataset.authBound = 'true';
        pageLoginForm.addEventListener("submit", async function(e) {
            e.preventDefault();

            const email = document.getElementById("login-email")?.value || document.getElementById("email")?.value;
            const password = document.getElementById("login-password")?.value || document.getElementById("password")?.value;
            const messageDisplay = document.getElementById("message");
            const submitButton = pageLoginForm.querySelector('button[type="submit"], input[type="submit"]');
            const originalSubmitLabel = submitButton ? submitButton.textContent : '';

            if (messageDisplay) {
                messageDisplay.textContent = '';
                messageDisplay.className = '';
            }

            if (!email || !password) {
                setInlineMessage(messageDisplay, 'Email and password are required.', 'error');
                return;
            }

            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = 'Please wait...';
            }

            try {
                await handleUnifiedPageAuth(email, password, messageDisplay);
            } catch (error) {
                setInlineMessage(messageDisplay, getAuthErrorMessage(error, 'Authentication failed. Please try again.'), 'error');
            } finally {
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.textContent = originalSubmitLabel || 'Continue';
                }
            }
        });
    }

    if (registerForm) {
        registerForm.addEventListener("submit", async function(e) {
            e.preventDefault();

            const messageDisplay = document.getElementById("message");
            const email = document.getElementById("email").value;
            const password = document.getElementById("password").value;

            const { data, error } = await supabase.auth.signUp({
                email: email,
                password: password,
                options: {
                    emailRedirectTo: getEmailRedirectTo()
                }
            });

            if (error) {
                messageDisplay.textContent = error.message;
                messageDisplay.className = "error";
                return;
            }

            if (data.user) {
                messageDisplay.textContent = "Registration successful! Please check your email to verify your account.";
                messageDisplay.className = "success";
                registerForm.reset();
            }
        });
    }
}

// =============================================================================
// NEW MODAL AUTHENTICATION SYSTEM
// =============================================================================

class AuthManager {
    constructor() {
        this.currentModal = null;
        this.onSuccessCallback = null;
        this.init();
    }

    init() {
        // Only bind global events, don't create modals yet
        if (!loginForm && !registerForm) {
            // Bind global close events
            document.addEventListener('click', (e) => {
                if (e.target.classList.contains('auth-modal-background')) {
                    this.closeCurrentModal();
                }
            });

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.currentModal) {
                    this.closeCurrentModal();
                }
            });
        }
    }

    createLoginModal() {
        const modalHTML = `
            <div id="login-modal" class="auth-modal hidden">
                <div class="auth-modal-background"></div>
                <div class="auth-modal-content">
                    <div class="auth-modal-header">
                        <h2>Login Required</h2>
                        <button class="auth-close-btn" onclick="authManager.closeCurrentModal()">&times;</button>
                    </div>
                    
                    <div class="auth-modal-body">
                        <p class="auth-message">Please log in to continue with this action.</p>
                        
                        <form id="modal-login-form" class="auth-form">
                            <div class="auth-input-group">
                                <label for="login-email">Email</label>
                                <input type="email" id="login-email">
                                <div class="auth-field-error" id="login-email-error" style="display: none;"></div>
                            </div>
                            
                            <div class="auth-input-group">
                                <label for="login-password">Password</label>
                                <input type="password" id="login-password">
                                <div class="auth-field-error" id="login-password-error" style="display: none;"></div>
                            </div>
                            
                            <div class="auth-error-message" id="login-error" style="display: none;"></div>
                            
                            <div class="auth-buttons">
                                <button type="submit" class="auth-submit-btn" id="login-submit">
                                    <span class="auth-btn-text">Login</span>
                                    <span class="auth-btn-loading" style="display: none;">Logging in...</span>
                                </button>
                                
                                <button type="button" class="auth-switch-btn" onclick="authManager.switchToRegister()">
                                    Don't have an account? Register
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Bind login form
        document.getElementById('modal-login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });
    }

    createRegisterModal() {
        const modalHTML = `
            <div id="register-modal" class="auth-modal hidden">
                <div class="auth-modal-background"></div>
                <div class="auth-modal-content">
                    <div class="auth-modal-header">
                        <h2>Create Account</h2>
                        <button class="auth-close-btn" onclick="authManager.closeCurrentModal()">&times;</button>
                    </div>
                    
                    <div class="auth-modal-body">
                        <p class="auth-message">Create an account to add courses and write reviews.</p>
                        
                        <form id="modal-register-form" class="auth-form">
                            <div class="auth-input-group">
                                <label for="register-email">Email</label>
                                <input type="email" id="register-email">
                                <div class="auth-field-error" id="register-email-error" style="display: none;"></div>
                            </div>
                            
                            <div class="auth-input-group">
                                <label for="register-password">Password</label>
                                <input type="password" id="register-password">
                                <div class="auth-field-error" id="register-password-error" style="display: none;"></div>
                            </div>
                            
                            <div class="auth-input-group">
                                <label for="register-password-confirm">Repeat Password</label>
                                <input type="password" id="register-password-confirm">
                                <div class="auth-field-error" id="register-password-confirm-error" style="display: none;"></div>
                            </div>
                            
                            <div class="auth-error-message" id="register-error" style="display: none;"></div>
                            
                            <div class="auth-buttons">
                                <button type="submit" class="auth-submit-btn" id="register-submit">
                                    <span class="auth-btn-text">Create Account</span>
                                    <span class="auth-btn-loading" style="display: none;">Creating account...</span>
                                </button>
                                
                                <button type="button" class="auth-switch-btn" onclick="authManager.switchToLogin()">
                                    Already have an account? Login
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Bind register form
        document.getElementById('modal-register-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleRegister();
        });
    }

    // Main method to check authentication and show modal if needed
    async requireAuth(action = 'perform this action', onSuccess = null) {
        try {
            // Check if user is already logged in
            const { data: { session } } = await supabase.auth.getSession();
            
            if (session && session.user) {
                // User is logged in, execute success callback
                if (onSuccess) onSuccess();
                return true;
            } else {
                // User not logged in, show login modal
                this.onSuccessCallback = onSuccess;
                this.showLoginModal(action);
                return false;
            }
        } catch (error) {
            console.error('Error checking authentication:', error);
            this.showLoginModal(action);
            return false;
        }
    }

    showLoginModal(action = 'perform this action') {
        let modal = document.getElementById('login-modal');
        if (!modal) {
            this.createLoginModal();
            modal = document.getElementById('login-modal');
        }
        
        const message = document.querySelector('#login-modal .auth-message');
        message.textContent = `Please log in to ${action}.`;
        
        // For first-time creation, add a small delay to ensure proper animation
        if (modal.classList.contains('hidden')) {
            setTimeout(() => {
                modal.classList.remove('hidden');
            }, 10);
        } else {
            modal.classList.remove('hidden');
        }
        
        this.currentModal = 'login';
        
        // Focus on email input
        setTimeout(() => {
            document.getElementById('login-email').focus();
        }, 100);
    }

    showRegisterModal() {
        let registerModal = document.getElementById('register-modal');
        if (!registerModal) {
            this.createRegisterModal();
            registerModal = document.getElementById('register-modal');
        }
        
        const loginModal = document.getElementById('login-modal');
        if (loginModal) {
            loginModal.classList.add('hidden');
        }
        
        // For first-time creation, add a small delay to ensure proper animation
        if (registerModal.classList.contains('hidden')) {
            setTimeout(() => {
                registerModal.classList.remove('hidden');
            }, 10);
        } else {
            registerModal.classList.remove('hidden');
        }
        
        this.currentModal = 'register';
        
        // Focus on email input
        setTimeout(() => {
            document.getElementById('register-email').focus();
        }, 100);
    }

    switchToRegister() {
        this.showRegisterModal();
    }

    switchToLogin() {
        let loginModal = document.getElementById('login-modal');
        if (!loginModal) {
            this.createLoginModal();
            loginModal = document.getElementById('login-modal');
        }
        
        const registerModal = document.getElementById('register-modal');
        if (registerModal) {
            registerModal.classList.add('hidden');
        }
        
        // For first-time creation, add a small delay to ensure proper animation
        if (loginModal.classList.contains('hidden')) {
            setTimeout(() => {
                loginModal.classList.remove('hidden');
            }, 10);
        } else {
            loginModal.classList.remove('hidden');
        }
        
        this.currentModal = 'login';
        
        setTimeout(() => {
            document.getElementById('login-email').focus();
        }, 100);
    }

    closeCurrentModal() {
        if (this.currentModal) {
            const modal = document.getElementById(`${this.currentModal}-modal`);
            if (modal) {
                modal.classList.add('hidden');
            }
            this.currentModal = null;
            this.onSuccessCallback = null;
            
            // Clear forms and errors
            this.clearForms();
        }
    }

    clearForms() {
        // Clear login form
        const loginForm = document.getElementById('modal-login-form');
        const registerForm = document.getElementById('modal-register-form');
        
        if (loginForm) {
            loginForm.reset();
            this.clearFieldErrors('login');
        }
        if (registerForm) {
            registerForm.reset();
            this.clearFieldErrors('register');
        }
        
        const loginError = document.getElementById('login-error');
        const registerError = document.getElementById('register-error');
        
        if (loginError) loginError.style.display = 'none';
        if (registerError) registerError.style.display = 'none';
        
        // Reset button states
        this.resetButtonStates();
    }

    resetButtonStates() {
        const buttons = ['login-submit', 'register-submit'];
        buttons.forEach(btnId => {
            const btn = document.getElementById(btnId);
            if (!btn) return;
            
            const textSpan = btn.querySelector('.auth-btn-text');
            const loadingSpan = btn.querySelector('.auth-btn-loading');
            
            btn.disabled = false;
            if (textSpan) textSpan.style.display = 'inline';
            if (loadingSpan) loadingSpan.style.display = 'none';
        });
    }

    showError(modalType, message) {
        const errorElement = document.getElementById(`${modalType}-error`);
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
        }
    }

    showFieldError(fieldId, message) {
        const errorElement = document.getElementById(`${fieldId}-error`);
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
        }
    }

    clearFieldErrors(modalType) {
        const fieldIds = modalType === 'login' 
            ? ['login-email', 'login-password']
            : ['register-email', 'register-password', 'register-password-confirm'];
            
        fieldIds.forEach(fieldId => {
            const errorElement = document.getElementById(`${fieldId}-error`);
            if (errorElement) {
                errorElement.style.display = 'none';
            }
        });
    }

    setButtonLoading(buttonId, isLoading) {
        const btn = document.getElementById(buttonId);
        if (!btn) return;
        
        const textSpan = btn.querySelector('.auth-btn-text');
        const loadingSpan = btn.querySelector('.auth-btn-loading');
        
        btn.disabled = isLoading;
        if (textSpan) textSpan.style.display = isLoading ? 'none' : 'inline';
        if (loadingSpan) loadingSpan.style.display = isLoading ? 'inline' : 'none';
    }

    async updateAuthState() {
        try {
            // Get fresh session to verify login was successful
            const { data: { session } } = await supabase.auth.getSession();
            
            if (session && session.user) {
                console.log('Login successful, reloading page to refresh all components');
                
                // Simply reload the current page - this ensures everything refreshes properly
                // The course modal will be gone, but that's expected after login
                window.location.reload();
            }
        } catch (error) {
            console.error('Error updating auth state:', error);
            // Still reload on error to ensure clean state
            window.location.reload();
        }
    }

    async handleLogin() {
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        
        // Clear previous errors
        this.clearFieldErrors('login');
        const loginError = document.getElementById('login-error');
        if (loginError) loginError.style.display = 'none';
        
        let hasErrors = false;
        
        // Validate email
        if (!email) {
            this.showFieldError('login-email', 'Email is required.');
            hasErrors = true;
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            this.showFieldError('login-email', 'Please enter a valid email address.');
            hasErrors = true;
        }
        
        // Validate password
        if (!password) {
            this.showFieldError('login-password', 'Password is required.');
            hasErrors = true;
        }
        
        if (hasErrors) {
            return;
        }

        this.setButtonLoading('login-submit', true);

        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email: email,
                password: password
            });

            if (error) {
                throw error;
            }

            // Login successful
            queueAuthSuccessToast();
            this.closeCurrentModal();
            
            // Update global session state and UI
            await this.updateAuthState();
            
            // Execute success callback if provided
            if (this.onSuccessCallback) {
                await this.onSuccessCallback();
                this.onSuccessCallback = null;
            }

        } catch (error) {
            console.error('Login error:', error);
            
            let errorMessage = 'Login failed. Please try again.';
            if (error.message.includes('Invalid login credentials')) {
                errorMessage = 'Invalid email or password. Please check your credentials.';
            } else if (error.message.includes('Email not confirmed')) {
                errorMessage = 'Please check your email and confirm your account before logging in.';
            }
            
            this.showError('login', errorMessage);
        } finally {
            this.setButtonLoading('login-submit', false);
        }
    }

    async handleRegister() {
        const email = document.getElementById('register-email').value.trim();
        const password = document.getElementById('register-password').value;
        const confirmPassword = document.getElementById('register-password-confirm').value;
        
        // Clear previous errors
        this.clearFieldErrors('register');
        const registerError = document.getElementById('register-error');
        if (registerError) registerError.style.display = 'none';
        
        let hasErrors = false;
        
        // Validate email
        if (!email) {
            this.showFieldError('register-email', 'Email is required.');
            hasErrors = true;
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            this.showFieldError('register-email', 'Please enter a valid email address.');
            hasErrors = true;
        }
        
        // Validate password
        if (!password) {
            this.showFieldError('register-password', 'Password is required.');
            hasErrors = true;
        } else if (password.length < 6) {
            this.showFieldError('register-password', 'Password must be at least 6 characters long.');
            hasErrors = true;
        }
        
        // Validate password confirmation
        if (!confirmPassword) {
            this.showFieldError('register-password-confirm', 'Please confirm your password.');
            hasErrors = true;
        } else if (password !== confirmPassword) {
            this.showFieldError('register-password-confirm', 'Passwords do not match.');
            hasErrors = true;
        }
        
        if (hasErrors) {
            return;
        }

        this.setButtonLoading('register-submit', true);

        try {
            const { data, error } = await supabase.auth.signUp({
                email: email,
                password: password,
                options: {
                    emailRedirectTo: getEmailRedirectTo()
                }
            });

            if (error) {
                throw error;
            }

            // Registration successful
            this.closeCurrentModal();
            
            // Show success message (keeping this as alert for now as it's a success message)
            alert('Registration successful! Please check your email to confirm your account, then try logging in.');

        } catch (error) {
            console.error('Registration error:', error);
            
            let errorMessage = 'Registration failed. Please try again.';
            if (error.message.includes('User already registered')) {
                errorMessage = 'This email is already registered. Please try logging in instead.';
            } else if (error.message.includes('Password should be at least')) {
                errorMessage = 'Password must be at least 6 characters long.';
            } else if (error.message.includes('Invalid email')) {
                errorMessage = 'Please enter a valid email address.';
            }
            
            this.showError('register', errorMessage);
        } finally {
            this.setButtonLoading('register-submit', false);
        }
    }
}

// Initialize auth handlers on page load
function initializeAuthPage() {
    setupAuthHandlers();
    flushPendingAuthSuccessToast();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAuthPage);
} else {
    initializeAuthPage();
}

// Re-initialize when pages are loaded via router
document.addEventListener('pageLoaded', () => {
    setupAuthHandlers();
    flushPendingAuthSuccessToast();
});

// Global instance - only create if not on dedicated login/register pages
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");

if (!loginForm && !registerForm) {
    window.authManager = new AuthManager();
    
    // Convenience function for use throughout the app
    window.requireAuth = (action, onSuccess) => authManager.requireAuth(action, onSuccess);
}

// Export for module use if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AuthManager };
}
