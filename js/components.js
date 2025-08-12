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
                    <li><button class="${document.title.includes('Profile') && 'active'}" id="profile"></button></li>
                    <li><button class="${document.title.includes('Dashboard') && 'active'}" id="dashboard"></button></li>
                    <li><button class="${document.title.includes('Calendar') && 'active'}" id="calendar"></button></li>
                    <li><button class="${document.title.includes('Search') && 'active'}" id="search"></button></li>
                    <li><button class="${document.title.includes('Settings') && 'active'}" id="settings"></button></li>
                    <li><button class="${document.title.includes('Help') && 'active'}" id="help"></button></li>
                </ul>
            </nav>
        `;
    }
}

customElements.define('app-navigation', AppNavigation);