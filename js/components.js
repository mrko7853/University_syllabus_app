import { supabase } from "/supabase.js";

const { data: { session } } = await supabase.auth.getSession();
const yearSelect = document.getElementById("year-select");
const termSelect = document.getElementById("term-select");

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
                      <h2 class="total-count">14</h2>
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

class ConcentrationTerm extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    this.shadowRoot.innerHTML = `
      <style>
        @import url('/css/blaze.css');
      </style>
      <div class="user-concentration">
        <h2 class="concentration-text" id="concentration-text-id"></h2>
        <h2 class="display-term"></h2>
      </div>
    `;

    this.handleSelectChange = () => this.updateDisplayTerm();
  }

  connectedCallback() {
    // Initialize concentration text
    this.initConcentration();

    // Set initial term/year display
    this.updateDisplayTerm();

    // Attach listeners to keep display updated on changes
    this._ys = document.getElementById('year-select');
    this._ts = document.getElementById('term-select');

    if (this._ys) this._ys.addEventListener('change', this.handleSelectChange);
    if (this._ts) this._ts.addEventListener('change', this.handleSelectChange);
  }

  disconnectedCallback() {
    if (this._ys) this._ys.removeEventListener('change', this.handleSelectChange);
    if (this._ts) this._ts.removeEventListener('change', this.handleSelectChange);
  }

  translateTerm(termRaw) {
    return (termRaw || '')
      .replace('春学期', 'Spring')
      .replace('秋学期', 'Fall')
      .trim();
  }

  updateDisplayTerm() {
    const displayEl = this.shadowRoot.querySelector('.display-term');
    if (!displayEl) return;

    const ys = document.getElementById('year-select');
    const ts = document.getElementById('term-select');

    let year = ys?.value || '';
    let termRaw = ts?.value || '';

    if (termRaw.includes('/')) {
      const parts = termRaw.split('/');
      if (parts.length > 1) {
        if (!year) year = (parts[0] || '').trim();
        termRaw = (parts[1] || '').trim();
      }
    }

    const term = this.translateTerm(termRaw);
    const text = `${term} ${year}`.trim();
    displayEl.textContent = text;
  }

  async initConcentration() {
    const concentrationText = this.shadowRoot.querySelector('.concentration-text');

    try {
      if (!user) {
        concentrationText.textContent = 'Global Culture';
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('concentration')
        .eq('id', user.id)
        .single();

      if (profileError) throw profileError;

      const userConcentration = profile?.concentration || [];
      concentrationText.textContent = userConcentration;

      if (concentrationText.textContent === "Global Culture") {
        concentrationText.parentElement.style.backgroundColor = "#C6E0B4";
      } else if (concentrationText.textContent === "Economy") {
        concentrationText.parentElement.style.backgroundColor = "#FFE699";
      } else if (concentrationText.textContent === "Politics") {
        concentrationText.parentElement.style.backgroundColor = "#FFCCCC";
      }
    } catch (error) {
      console.error('Error fetching total courses:', error);
      concentrationText.textContent = '0';
    }
  }
}

customElements.define('app-navigation', AppNavigation);
customElements.define('total-courses', TotalCourses);
customElements.define('concentration-term', ConcentrationTerm);