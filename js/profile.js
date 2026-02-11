import { supabase } from "../supabase.js";
import { getCurrentAppPath } from "./path-utils.js";

async function initializeProfile() {
    const { data: { session } } = await supabase.auth.getSession();

    if (session) {
        const userTestMessage = document.getElementById("user-test-message");
        if (userTestMessage) {
            userTestMessage.textContent = `Your email is: ${session.user.email}`;
        }
    }
    // Don't redirect - let the router handle showing the locked page
    
    // Set up logout button
    const logoutButton = document.getElementById("logout-button");
    if (logoutButton) {
        // Remove any existing listeners
        logoutButton.replaceWith(logoutButton.cloneNode(true));
        const newLogoutButton = document.getElementById("logout-button");
        
        newLogoutButton.addEventListener("click", async function() {
            try {
                // Sign out from Supabase
                const { error } = await supabase.auth.signOut();
                
                if (error) {
                    console.error('Error during logout:', error);
                    alert('Error during logout. Please try again.');
                    return;
                }

                // Clear any local storage if needed
                localStorage.removeItem("token");
                
                // Navigate to login via router instead of direct redirect
                if (window.router) {
                    window.router.navigate('/login');
                } else {
                    window.location.href = "login.html";
                }
            } catch (error) {
                console.error('Unexpected error during logout:', error);
                alert('An unexpected error occurred during logout.');
            }
        });
    }
}

document.addEventListener("DOMContentLoaded", initializeProfile);

// Listen for router navigation
document.addEventListener('pageLoaded', (e) => {
    if (e.detail.path === '/profile' || getCurrentAppPath() === '/profile') {
        setTimeout(initializeProfile, 100);
    }
});

// Export for router use
export { initializeProfile };

// Make available globally for production builds
window.initializeProfile = initializeProfile;
