import { supabase } from "/supabase.js";

document.addEventListener("DOMContentLoaded", async function() {
    const { data: { session } } = await supabase.auth.getSession();

    if (session) {
        document.getElementById("user-test-message").textContent = `Your email is: ${session.user.email}`;
    } else {
        window.location.href = "login.html";
    }
});

document.getElementById("logout-button").addEventListener("click", function() {
    localStorage.removeItem("token");
    window.location.href = "login.html";
});