import { supabase } from "/supabase.js";

// Legacy form handlers (keep for backward compatibility with existing pages)
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");

if (loginForm) {
    loginForm.addEventListener("submit", async function(e) {
        e.preventDefault();

        const email = document.getElementById("email").value;
        const password = document.getElementById("password").value;

        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password,
        });

        if (error) {
            alert(error.message);
            console.log(error.message);
        } else {
            window.location.href = "profile.html";
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
                                <input type="email" id="login-email" required>
                            </div>
                            
                            <div class="auth-input-group">
                                <label for="login-password">Password</label>
                                <input type="password" id="login-password" required>
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
                                <input type="email" id="register-email" required>
                            </div>
                            
                            <div class="auth-input-group">
                                <label for="register-password">Password</label>
                                <input type="password" id="register-password" required minlength="6">
                            </div>
                            
                            <div class="auth-input-group">
                                <label for="register-password-confirm">Repeat Password</label>
                                <input type="password" id="register-password-confirm" required minlength="6">
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
        
        modal.classList.remove('hidden');
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
        
        registerModal.classList.remove('hidden');
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
        
        loginModal.classList.remove('hidden');
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
        
        if (loginForm) loginForm.reset();
        if (registerForm) registerForm.reset();
        
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

    setButtonLoading(buttonId, isLoading) {
        const btn = document.getElementById(buttonId);
        if (!btn) return;
        
        const textSpan = btn.querySelector('.auth-btn-text');
        const loadingSpan = btn.querySelector('.auth-btn-loading');
        
        btn.disabled = isLoading;
        if (textSpan) textSpan.style.display = isLoading ? 'none' : 'inline';
        if (loadingSpan) loadingSpan.style.display = isLoading ? 'inline' : 'none';
    }

    async handleLogin() {
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        
        if (!email || !password) {
            this.showError('login', 'Please enter both email and password.');
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
            this.closeCurrentModal();
            
            // Execute success callback if provided
            if (this.onSuccessCallback) {
                this.onSuccessCallback();
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
        
        // Validation
        if (!email || !password || !confirmPassword) {
            this.showError('register', 'Please fill in all fields.');
            return;
        }

        if (password !== confirmPassword) {
            this.showError('register', 'Passwords do not match.');
            return;
        }

        if (password.length < 6) {
            this.showError('register', 'Password must be at least 6 characters long.');
            return;
        }

        this.setButtonLoading('register-submit', true);

        try {
            const { data, error } = await supabase.auth.signUp({
                email: email,
                password: password
            });

            if (error) {
                throw error;
            }

            // Registration successful
            this.closeCurrentModal();
            
            // Show success message
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

// Global instance - only create if not on dedicated login/register pages
if (!loginForm && !registerForm) {
    window.authManager = new AuthManager();
    
    // Convenience function for use throughout the app
    window.requireAuth = (action, onSuccess) => authManager.requireAuth(action, onSuccess);
}

// Export for module use if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AuthManager };
}