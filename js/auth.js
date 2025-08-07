import { supabase } from "/supabase.js";

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
            messageDisplay.textContent = data.messsage;
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