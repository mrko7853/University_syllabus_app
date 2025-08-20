class AppNavigation extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = `
            <style>
                @import url('/css/blaze.css');
            </style>
            <nav class="test">
                <ul>
                    <div class="profile-menu-container">
                    <li><button class="${document.title.includes('Profile') && 'active'}" id="profile"></button>
                        <p class="navigation-text">Profile</p></li>
                      <div class="profile-dropdown-menu">
                        <a href="#view-profile">View Profile</a>
                        <a href="#settings">Settings</a>
                        <a href="#logout">Logout</a>
                      </div>
                    </div>
                    <div class="accessibility-container">
                    <li><button class="${document.title.includes('Dashboard') && 'active'}" id="dashboard"></button>
                        <p class="navigation-text">Dashboard</p></li>
                      <div class="accessibility-dropdown">
                        <p>Dashboard</p>
                      </div>
                    </div>
                    <div class="accessibility-container">
                    <li><button class="${document.title.includes('Calendar') && 'active'}" id="calendar-btn"></button>
                      <p class="navigation-text">Calendar</p></li>
                    <div class="accessibility-dropdown">
                        <p>Calendar</p>
                      </div>
                    </div>
                    <div class="accessibility-container">
                    <li><button class="${document.title.includes('Search') && 'active'}" id="search"></button>
                        <p class="navigation-text">Search</p></li>
                      <div class="accessibility-dropdown">
                        <p>Search</p>
                      </div>
                    </div>
                    <div class="accessibility-container accessibility-down">
                    <li><button class="${document.title.includes('Settings') && 'active'}" id="settings"></button></li>
                      <div class="accessibility-dropdown">
                        <p>Settings</p>
                      </div>
                    </div>
                    <div class="accessibility-container accessibility-down">
                    <li><button class="${document.title.includes('Help') && 'active'}" id="help"></button></li>
                      <div class="accessibility-dropdown">
                        <p>Help</p>
                      </div>
                    </div>
                </ul>
            </nav>
        `;
    }
}

class TotalCourses extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = `
            <style>
                @import url('/css/blaze.css');
            </style>
            <div class="total-courses">
                <h2 class="total-count">0</h2>
                <h2 class="total-text">Registered<br>Courses</h2>
            </div>
        `;
    }
}

customElements.define('app-navigation', AppNavigation);
customElements.define('total-courses', TotalCourses);