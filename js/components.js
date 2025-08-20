import { supabase } from "/supabase.js";

const { data: { session } } = await supabase.auth.getSession();

const user = session?.user || null;

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

        const totalCountEl = this.shadowRoot.querySelector('.total-count');

        const fetchTotalCourses = async () => {
            try {
                if (!user) {
                  return (this.shadowRoot.innerHTML = `
                    <style>
                      @import url('/css/blaze.css');
                    </style>
                    <div class="total-courses">
                      <h2 class="total-count">20</h2>
                      <h2 class="total-text">Registered<br>Courses</h2>
                    </div>
                  `);
                }

                const { data: profile, error: profileError } = await supabase
                    .from('profiles')
                    .select('courses_selection')
                    .eq('id', user.id)
                    .single();

                if (profileError) {
                    throw profileError;
                }

                const selectedCourses = profile?.courses_selection || [];
                return selectedCourses.length;
            } catch (error) {
                console.error('Error fetching total courses:', error);
                return 0; // Return 0 if there's an error
            }
        };

        fetchTotalCourses().then((count) => {
            totalCountEl.textContent = String(count);
        });
    }
}

customElements.define('app-navigation', AppNavigation);
customElements.define('total-courses', TotalCourses);