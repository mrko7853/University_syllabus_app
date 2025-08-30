import { supabase } from "/supabase.js";

document.addEventListener("DOMContentLoaded", async function() {
    const { data: { session } } = await supabase.auth.getSession();

    if (session) {
        document.getElementById("user-test-message").textContent = `Your email is: ${session.user.email}`;
    } else {
        window.location.href = "login.html";
    }
});

document.getElementById("logout-button").addEventListener("click", async function() {
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
        
        // Redirect to login page
        window.location.href = "login.html";
    } catch (error) {
        console.error('Unexpected error during logout:', error);
        alert('An unexpected error occurred during logout.');
    }
});