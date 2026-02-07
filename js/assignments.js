import { supabase } from "/supabase.js";
import { fetchAvailableSemesters, fetchCourseData, getCourseColorByType } from "/js/shared.js";

/**
 * Assignments Manager - Handles all assignment CRUD operations and UI
 */
class AssignmentsManager {
    constructor() {
        this.root = document.getElementById('assignments-main');
        this.assignments = [];
        this.userCourses = [];
        this.userCourseSelections = [];
        this.currentAssignment = null;
        this.currentView = 'all-assignments';
        this.previousView = null;
        this.calendarDate = new Date();
        this.datePickerTarget = null;
        this.datePickerDate = new Date();
        this.isInitialized = false;
        this.isInitializing = false;
        this.isNewAssignment = false;
        this.eventListenersSetup = false;
        this.isSaving = false;
    }

    async init() {
        if (this.isInitialized || this.isInitializing) return;
        this.isInitializing = true;

        try {
            console.log('Assignments Manager: Starting initialization...');

            // Setup event listeners FIRST - these should always work
            this.setupEventListeners();

            await this.setupContainerAbove();

            // Check authentication
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.user) {
                console.log('User not authenticated, assignments data not loaded (but UI is ready)');
                this.isInitialized = true;
                return;
            }

            this.currentUser = session.user;

            // Load user's registered courses for tag selection
            await this.loadUserCourses();

            // Load assignments
            await this.loadAssignments();

            // Render initial view
            this.renderAssignments();

            this.isInitialized = true;
            console.log('Assignments Manager: Fully initialized with user data');

            // Check for hash URL to open specific assignment
            this.handleHashURL();
        } finally {
            this.isInitializing = false;
        }
    }

    handleHashURL() {
        const hash = window.location.hash;
        console.log('handleHashURL called, hash:', hash, 'assignments count:', this.assignments.length);

        if (hash && hash.startsWith('#assignment-')) {
            const assignmentId = hash.replace('#assignment-', '');
            console.log('Looking for assignment with ID:', assignmentId);
            console.log('Available assignments:', this.assignments.map(a => ({ id: a.id, title: a.title })));

            // Find the assignment and open its modal
            const assignment = this.assignments.find(a => a.id === assignmentId);
            if (assignment) {
                console.log('Found assignment, opening modal:', assignment.title);
                // Larger delay to ensure DOM is fully ready
                setTimeout(() => {
                    const overlay = document.getElementById('assignment-modal-overlay');
                    console.log('Overlay element exists:', !!overlay);
                    if (overlay) {
                        this.openAssignmentModal(assignment);
                    } else {
                        console.error('Modal overlay not found in DOM');
                    }
                }, 500);
            } else {
                console.warn('Assignment not found for hash:', assignmentId);
            }

            // Clear the hash to avoid reopening on refresh
            window.history.replaceState(null, '', window.location.pathname);
        }
    }

    async loadUserCourses() {
        try {
            const { data: profile, error } = await supabase
                .from('profiles')
                .select('courses_selection')
                .eq('id', this.currentUser.id)
                .single();

            if (error) throw error;

            const coursesSelection = profile?.courses_selection || [];
            this.userCourseSelections = coursesSelection
                .filter(course => course?.code && course?.year && course?.term);
            console.log('Raw courses_selection:', coursesSelection);

            // Deduplicate course codes first
            const uniqueCourseCodes = [...new Set(this.userCourseSelections.map(c => c.code))];
            console.log('Unique course codes:', uniqueCourseCodes);

            if (uniqueCourseCodes.length > 0) {
                const { data: coursesData, error: coursesError } = await supabase
                    .from('courses')
                    .select('course_code, title, type')
                    .in('course_code', uniqueCourseCodes);

                if (!coursesError && coursesData && coursesData.length > 0) {
                    // Deduplicate by course_code in case the query returns duplicates
                    const seenCodes = new Set();
                    const courseMap = new Map();
                    coursesData.forEach(course => {
                        courseMap.set(course.course_code, course);
                    });

                    this.userCourses = this.userCourseSelections.map(selection => {
                        const course = courseMap.get(selection.code);
                        const type = course?.type || selection.type || 'General';
                        return {
                            code: selection.code,
                            title: course?.title || selection.title || selection.code,
                            type,
                            color: getCourseColorByType(type),
                            year: selection.year,
                            term: selection.term
                        };
                    });
                } else {
                    // Fallback with deduplication
                    this.userCourses = this.userCourseSelections.map(course => ({
                        code: course.code,
                        title: course.title || course.code,
                        type: course.type || 'General',
                        color: getCourseColorByType(course.type || 'General'),
                        year: course.year,
                        term: course.term
                    }));
                }
            }

            console.log('Loaded user courses (deduplicated):', this.userCourses);
        } catch (error) {
            console.error('Error loading user courses:', error);
            this.userCourses = [];
        }
    }

    async loadAssignments() {
        try {
            const { data, error } = await supabase
                .from('assignments')
                .select('*')
                .eq('user_id', this.currentUser.id)
                .order('due_date', { ascending: true });

            if (error) throw error;

            this.assignments = data || [];
            console.log('Loaded assignments:', this.assignments.length);
        } catch (error) {
            console.error('Error loading assignments:', error);
            this.assignments = [];
        }
    }

    async openNewAssignmentModal() {
        if (!this.currentUser) {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.user) {
                if (window.authManager && window.authManager.showLoginModal) {
                    window.authManager.showLoginModal('create an assignment');
                    return;
                }
                alert('Please log in to create assignments.');
                return;
            }
            this.currentUser = session.user;
            await this.loadUserCourses();
            await this.loadAssignments();
        }

        this.currentAssignment = null;
        this.isNewAssignment = true;
        this.previousView = this.currentView;

        const overlay = document.getElementById('assignment-modal-overlay');
        const titleInput = document.getElementById('assignment-modal-title');
        const dueDateInput = document.getElementById('assignment-modal-due-date');
        const statusSelect = document.getElementById('assignment-modal-status');
        const instructionsTextarea = document.getElementById('assignment-modal-instructions');
        const subjectTag = document.getElementById('subject-tag');
        const subjectDropdown = document.getElementById('subject-dropdown');
        const deleteBtn = document.getElementById('assignment-delete-btn');
        const emojiTrigger = document.getElementById('assignment-emoji-trigger');

        if (!overlay) return;

        if (titleInput) titleInput.value = '';
        if (dueDateInput) dueDateInput.value = this.formatDateInputValue(new Date());
        if (statusSelect) statusSelect.value = 'not_started';
        if (instructionsTextarea) instructionsTextarea.value = '';
        if (emojiTrigger) {
            emojiTrigger.textContent = '📄';
            emojiTrigger.dataset.emoji = '📄';
        }

        if (deleteBtn) deleteBtn.style.display = 'none';

        if (subjectTag) {
            subjectTag.textContent = 'Select course';
            subjectTag.style.backgroundColor = '#e0e0e0';
            subjectTag.classList.remove('has-tag');
            subjectTag.dataset.code = '';
            subjectTag.dataset.color = '';
            subjectTag.dataset.year = '';
            subjectTag.dataset.term = '';
        }

        this.populateSubjectDropdown(subjectDropdown, subjectTag);

        overlay.style.display = 'flex';
    }

    populateSubjectDropdown(subjectDropdown, subjectTag) {
        if (!subjectDropdown) return;

        const coursesForSemester = this.getCoursesForSelectedSemester();
        console.log('Populating dropdown with courses:', coursesForSemester);

        subjectDropdown.innerHTML = `
            <div class="subject-option no-subject" data-code="" data-name="" data-color="">
                <span class="option-tag" style="background-color: #e0e0e0">None</span>
            </div>
            ${coursesForSemester.map(course => `
                <div class="subject-option" 
                     data-code="${course.code}" 
                     data-name="${this.escapeHtml(course.title)}"
                     data-color="${course.color}"
                     data-year="${course.year}"
                     data-term="${course.term}">
                    <span class="option-tag" style="background-color: ${course.color}">
                        ${this.truncateText(course.title, 25)}
                    </span>
                </div>
            `).join('')}
        `;

        subjectDropdown.querySelectorAll('.subject-option').forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const name = option.dataset.name;
                const color = option.dataset.color;

                if (subjectTag) {
                    if (name) {
                        subjectTag.textContent = name;
                        subjectTag.style.backgroundColor = color;
                        subjectTag.classList.add('has-tag');
                        subjectTag.dataset.code = option.dataset.code;
                        subjectTag.dataset.color = color;
                        subjectTag.dataset.year = option.dataset.year || '';
                        subjectTag.dataset.term = option.dataset.term || '';
                    } else {
                        subjectTag.textContent = 'Select course';
                        subjectTag.style.backgroundColor = '#e0e0e0';
                        subjectTag.classList.remove('has-tag');
                        subjectTag.dataset.code = '';
                        subjectTag.dataset.color = '';
                        subjectTag.dataset.year = '';
                        subjectTag.dataset.term = '';
                    }
                }

                subjectDropdown.style.display = 'none';
            });
        });
    }

    async updateAssignment(id, updates) {
        try {
            const { data, error } = await supabase
                .from('assignments')
                .update({ ...updates, updated_at: new Date().toISOString() })
                .eq('id', id)
                .eq('user_id', this.currentUser.id)
                .select()
                .single();

            if (error) throw error;

            const index = this.assignments.findIndex(a => a.id === id);
            if (index !== -1) {
                this.assignments[index] = data;
            }

            this.renderAssignments();
            return data;
        } catch (error) {
            console.error('Error updating assignment:', error);
            alert('Failed to update assignment. Please try again.');
            return null;
        }
    }

    async deleteAssignment(id) {
        if (!confirm('Are you sure you want to delete this assignment?')) {
            return false;
        }

        try {
            const { error } = await supabase
                .from('assignments')
                .delete()
                .eq('id', id)
                .eq('user_id', this.currentUser.id);

            if (error) throw error;

            this.assignments = this.assignments.filter(a => a.id !== id);
            this.closeAssignmentModal();
            this.renderAssignments();
            return true;
        } catch (error) {
            console.error('Error deleting assignment:', error);
            alert('Failed to delete assignment. Please try again.');
            return false;
        }
    }

    setupEventListeners() {
        if (window._assignmentsListenersBound && window._assignmentsListenersRoot === this.root) {
            return;
        }
        if (this.eventListenersSetup) {
            console.log('Event listeners already setup, skipping');
            return;
        }
        this.eventListenersSetup = true;
        window._assignmentsListenersBound = true;
        window._assignmentsListenersRoot = this.root;
        console.log('Setting up event listeners...');

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const view = e.currentTarget.dataset.view;
                this.switchView(view);
            });
        });

        const newBtn = document.getElementById('new-assignment-btn');
        if (newBtn) {
            newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openNewAssignmentModal();
            });
        }

        const quickAddRow = document.getElementById('quick-add-row');
        if (quickAddRow) {
            quickAddRow.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openNewAssignmentModal();
            });
        }

        const modalClose = document.getElementById('assignment-modal-close');
        const modalOverlay = document.getElementById('assignment-modal-overlay');
        if (modalClose) {
            modalClose.addEventListener('click', () => this.closeAssignmentModal());
        }
        if (modalOverlay) {
            modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay) {
                    this.closeAssignmentModal();
                }
            });
        }

        const saveBtn = document.getElementById('assignment-save-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.saveCurrentAssignment();
            });
        }

        const emojiTrigger = document.getElementById('assignment-emoji-trigger');
        const emojiPicker = document.getElementById('assignment-emoji-picker');
        const emojiSearch = document.getElementById('assignment-emoji-search');
        const emojiRandom = document.getElementById('assignment-emoji-random');
        const emojiPreview = document.getElementById('assignment-emoji-preview');
        const emojiRemove = document.getElementById('assignment-emoji-remove');
        if (emojiTrigger && emojiPicker) {
            emojiTrigger.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const isHidden = emojiPicker.style.display === 'none' || emojiPicker.style.display === '';
                emojiPicker.style.display = isHidden ? 'flex' : 'none';
            });

            emojiPicker.addEventListener('click', (e) => {
                const button = e.target.closest('.emoji-option');
                if (!button) return;
                emojiTrigger.textContent = button.textContent;
                emojiTrigger.dataset.emoji = button.textContent;
                emojiPicker.style.display = 'none';
            });

            if (emojiSearch) {
                emojiSearch.addEventListener('input', () => {
                    const query = emojiSearch.value.trim().toLowerCase();
                    emojiPicker.querySelectorAll('.emoji-option').forEach(btn => {
                        const label = btn.textContent.toLowerCase();
                        const keywords = (btn.dataset.keywords || '').toLowerCase();
                        const matches = !query || label.includes(query) || keywords.includes(query);
                        btn.style.display = matches ? 'inline-flex' : 'none';
                    });
                });
            }

            if (emojiRandom) {
                emojiRandom.addEventListener('click', () => {
                    const buttons = Array.from(emojiPicker.querySelectorAll('.emoji-option')).filter(btn => btn.style.display !== 'none');
                    if (buttons.length === 0) return;
                    const randomButton = buttons[Math.floor(Math.random() * buttons.length)];
                    emojiTrigger.textContent = randomButton.textContent;
                    emojiTrigger.dataset.emoji = randomButton.textContent;
                    emojiPicker.style.display = 'none';
                });
            }

            if (emojiPreview) {
                emojiPicker.addEventListener('mouseover', (event) => {
                    const target = event.target.closest('button');
                    if (target && target.classList.contains('emoji-option') && target.textContent) {
                        emojiPreview.textContent = target.textContent;
                    }
                });
            }

            if (emojiRemove) {
                emojiRemove.addEventListener('click', () => {
                    emojiTrigger.textContent = '';
                    emojiTrigger.dataset.emoji = '';
                    emojiPicker.style.display = 'none';
                });
            }

            document.addEventListener('click', (e) => {
                if (!emojiPicker.contains(e.target) && !emojiTrigger.contains(e.target)) {
                    emojiPicker.style.display = 'none';
                }
            });
        }

        const deleteBtn = document.getElementById('assignment-delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                if (this.currentAssignment) {
                    this.deleteAssignment(this.currentAssignment.id);
                }
            });
        }

        const subjectCurrent = document.getElementById('subject-current');
        const subjectDropdown = document.getElementById('subject-dropdown');
        if (subjectCurrent && subjectDropdown) {
            // Clone the element to remove any existing event listeners
            const newSubjectCurrent = subjectCurrent.cloneNode(true);
            subjectCurrent.parentNode.replaceChild(newSubjectCurrent, subjectCurrent);

            newSubjectCurrent.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const dropdown = document.getElementById('subject-dropdown');
                const isHidden = dropdown.style.display === 'none' || dropdown.style.display === '';
                dropdown.style.display = isHidden ? 'block' : 'none';
                console.log('Dropdown toggled:', isHidden ? 'shown' : 'hidden');
            });

            // Only add document click listener once globally to prevent duplicates
            if (!window._assignmentDropdownCloseHandlerAdded) {
                window._assignmentDropdownCloseHandlerAdded = true;
                document.addEventListener('click', (e) => {
                    const dropdown = document.getElementById('subject-dropdown');
                    const current = document.getElementById('subject-current');
                    if (dropdown && current && !current.contains(e.target) && !dropdown.contains(e.target)) {
                        dropdown.style.display = 'none';
                    }
                });
            }
        }

        const prevMonth = document.getElementById('calendar-prev-month');
        const nextMonth = document.getElementById('calendar-next-month');
        const todayBtn = document.getElementById('calendar-today-btn');

        if (prevMonth) {
            prevMonth.addEventListener('click', () => {
                this.calendarDate.setMonth(this.calendarDate.getMonth() - 1);
                this.renderCalendarView();
            });
        }
        if (nextMonth) {
            nextMonth.addEventListener('click', () => {
                this.calendarDate.setMonth(this.calendarDate.getMonth() + 1);
                this.renderCalendarView();
            });
        }
        if (todayBtn) {
            todayBtn.addEventListener('click', () => {
                this.calendarDate = new Date();
                this.renderCalendarView();
            });
        }

        const modalDueDateInput = document.getElementById('assignment-modal-due-date');
        if (modalDueDateInput) {
            modalDueDateInput.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openDatePicker(modalDueDateInput, this.currentAssignment, { mode: 'modal' });
            });
        }

        this.setupDatePicker();
    }

    async setupContainerAbove() {
        await this.populateSemesterDropdown();
        this.initializeCustomSelects();
        this.setupSearchModal();
        await this.loadSearchCourses();
        this.setupSearchAutocomplete();
    }

    async populateSemesterDropdown() {
        const semesters = await fetchAvailableSemesters();
        const semesterSelects = document.querySelectorAll('.semester-select');
        const customSelects = document.querySelectorAll('.custom-select[data-target^="semester-select"]');

        if (semesterSelects.length === 0 || customSelects.length === 0) return;

        semesterSelects.forEach(select => {
            select.innerHTML = '';
            semesters.forEach((semester, index) => {
                const option = document.createElement('option');
                option.value = `${semester.term}-${semester.year}`;
                option.textContent = semester.label;
                if (index === 0) option.selected = true;
                select.appendChild(option);
            });
        });

        customSelects.forEach(customSelect => {
            const optionsContainer = customSelect.querySelector('.custom-select-options');
            const valueElement = customSelect.querySelector('.custom-select-value');

            if (!optionsContainer || !valueElement) return;

            optionsContainer.innerHTML = '';
            semesters.forEach((semester, index) => {
                const customOption = document.createElement('div');
                customOption.className = `custom-select-option${index === 0 ? ' selected' : ''}`;
                customOption.dataset.value = `${semester.term}-${semester.year}`;
                customOption.textContent = semester.label;
                optionsContainer.appendChild(customOption);
            });

            if (semesters.length > 0) {
                valueElement.textContent = semesters[0].label;
            }
        });

        this.setupSemesterSync();
    }

    setupSemesterSync() {
        const semesterSelects = document.querySelectorAll('.semester-select');
        semesterSelects.forEach(select => {
            if (select.dataset.listenerAttached === 'true') return;
            select.dataset.listenerAttached = 'true';
            select.addEventListener('change', async () => {
                const value = select.value;
                semesterSelects.forEach(other => {
                    if (other.value !== value) other.value = value;
                });

                const customSelects = document.querySelectorAll('.custom-select[data-target^="semester-select"]');
                customSelects.forEach(customSelect => {
                    const valueElement = customSelect.querySelector('.custom-select-value');
                    const options = customSelect.querySelectorAll('.custom-select-option');

                    options.forEach(option => {
                        option.classList.remove('selected');
                        if (option.dataset.value === value) {
                            option.classList.add('selected');
                            if (valueElement) valueElement.textContent = option.textContent;
                        }
                    });
                });

                await this.loadSearchCourses();
                this.refreshAutocompleteResults();
                this.renderAssignments();
                const subjectDropdown = document.getElementById('subject-dropdown');
                const subjectTag = document.getElementById('subject-tag');
                if (subjectDropdown && subjectTag) {
                    this.populateSubjectDropdown(subjectDropdown, subjectTag);
                }
            });
        });
    }

    getSelectedSemester() {
        const semesterSelect = document.getElementById('semester-select')
            || document.getElementById('semester-select-mobile')
            || document.querySelector('.semester-select');

        if (!semesterSelect || !semesterSelect.value) return null;

        const [term, year] = semesterSelect.value.split('-');
        if (!term || !year) return null;

        return { term, year };
    }

    async loadSearchCourses() {
        const selected = this.getSelectedSemester();
        if (!selected) {
            this.searchCourses = [];
            return;
        }

        try {
            const courses = await fetchCourseData(selected.year, selected.term);
            this.searchCourses = courses || [];
        } catch (error) {
            console.error('Error loading courses for search:', error);
            this.searchCourses = [];
        }
    }

    setupSearchAutocomplete() {
        const pillInput = document.getElementById('search-pill-input');
        const pillAutocomplete = document.getElementById('search-pill-autocomplete');
        const modalInput = document.getElementById('search-input');
        const modalAutocomplete = document.getElementById('search-autocomplete');

        if (pillInput && pillAutocomplete) {
            this.attachAutocompleteHandlers(pillInput, pillAutocomplete);
        }

        if (modalInput && modalAutocomplete) {
            this.attachAutocompleteHandlers(modalInput, modalAutocomplete);
        }
    }

    attachAutocompleteHandlers(input, autocompleteContainer) {
        const renderSuggestions = (query) => this.renderAutocomplete(query, input, autocompleteContainer);

        input.addEventListener('input', (event) => renderSuggestions(event.target.value));
        input.addEventListener('focus', async (event) => {
            await this.loadSearchCourses();
            renderSuggestions(event.target.value);
        });
        input.addEventListener('click', async (event) => {
            await this.loadSearchCourses();
            renderSuggestions(event.target.value);
        });
    }

    renderAutocomplete(query, input, autocompleteContainer) {
        const trimmed = query.trim();
        if (!trimmed || trimmed.length < 2) {
            autocompleteContainer.style.display = 'none';
            autocompleteContainer.innerHTML = '';
            return;
        }

        const normalizedQuery = trimmed.toLowerCase();
        const suggestions = (this.searchCourses || []).filter(course => {
            const title = (course.title || '').toLowerCase();
            const professor = (course.professor || '').toLowerCase();
            const code = (course.course_code || '').toLowerCase();
            return title.includes(normalizedQuery) || professor.includes(normalizedQuery) || code.includes(normalizedQuery);
        }).slice(0, 6);

        if (suggestions.length === 0) {
            autocompleteContainer.style.display = 'none';
            autocompleteContainer.innerHTML = '';
            return;
        }

        autocompleteContainer.innerHTML = suggestions.map(course => {
            const title = this.escapeHtml(course.title || '');
            const professor = this.escapeHtml(course.professor || '');
            const code = this.escapeHtml(course.course_code || '');
            return `
                <div class="search-autocomplete-item" data-title="${title}">
                    <div class="item-title">${title}</div>
                    <div class="item-details">
                        <span class="item-code">${code}</span>
                        <span class="item-professor">${professor}</span>
                    </div>
                </div>
            `;
        }).join('');

        autocompleteContainer.style.display = 'block';

        autocompleteContainer.querySelectorAll('.search-autocomplete-item').forEach(item => {
            item.addEventListener('click', (event) => {
                event.preventDefault();
                input.value = item.dataset.title || '';
                autocompleteContainer.style.display = 'none';
                autocompleteContainer.innerHTML = '';

                const selectedCourse = (this.searchCourses || []).find(course => course.title === item.dataset.title)
                    || (this.searchCourses || []).find(course => (course.course_code || '') === (item.dataset.code || ''));

                if (selectedCourse && window.openCourseInfoMenu) {
                    window.openCourseInfoMenu(selectedCourse);
                }

                if (input.id === 'search-input') {
                    const searchCancel = document.getElementById('search-cancel');
                    if (searchCancel) searchCancel.click();
                }
            });
        });
    }

    refreshAutocompleteResults() {
        const pillInput = document.getElementById('search-pill-input');
        const pillAutocomplete = document.getElementById('search-pill-autocomplete');
        const modalInput = document.getElementById('search-input');
        const modalAutocomplete = document.getElementById('search-autocomplete');

        if (pillInput && pillAutocomplete) {
            this.renderAutocomplete(pillInput.value || '', pillInput, pillAutocomplete);
        }

        if (modalInput && modalAutocomplete) {
            this.renderAutocomplete(modalInput.value || '', modalInput, modalAutocomplete);
        }
    }

    initializeCustomSelects() {
        const customSelects = document.querySelectorAll('.custom-select');
        if (customSelects.length === 0) return;

        customSelects.forEach(customSelect => {
            const trigger = customSelect.querySelector('.custom-select-trigger');
            const options = customSelect.querySelector('.custom-select-options');
            const targetSelectId = customSelect.dataset.target;
            const targetSelect = document.getElementById(targetSelectId);

            if (!trigger || !options || !targetSelect) return;
            if (customSelect.dataset.initialized === 'true') return;
            customSelect.dataset.initialized = 'true';

            trigger.addEventListener('click', (event) => {
                event.stopPropagation();
                document.querySelectorAll('.custom-select').forEach(other => {
                    if (other !== customSelect) other.classList.remove('open');
                });
                customSelect.classList.toggle('open');
            });

            options.addEventListener('click', (event) => {
                const option = event.target.closest('.custom-select-option');
                if (!option) return;

                const value = option.dataset.value;
                const text = option.textContent;

                options.querySelectorAll('.custom-select-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');

                const valueElement = trigger.querySelector('.custom-select-value');
                if (valueElement) valueElement.textContent = text;

                targetSelect.value = value;
                targetSelect.dispatchEvent(new Event('change', { bubbles: true }));

                customSelect.classList.remove('open');
            });
        });

        if (!this.customSelectsInitialized) {
            document.addEventListener('click', (event) => {
                if (!event.target.closest('.custom-select')) {
                    document.querySelectorAll('.custom-select').forEach(customSelect => {
                        customSelect.classList.remove('open');
                    });
                }
            });
            this.customSelectsInitialized = true;
        }
    }

    setupSearchModal() {
        const searchButtons = document.querySelectorAll('.search-btn');
        const searchContainer = document.querySelector('.search-container');
        const searchModal = document.querySelector('.search-modal');
        const searchBackground = document.querySelector('.search-background');
        const searchCancel = document.getElementById('search-cancel');
        const searchSubmit = document.getElementById('search-submit');

        if (!searchContainer || !searchModal || searchButtons.length === 0) return;

        const closeSearch = (immediate = false) => {
            if (window.innerWidth <= 780) {
                searchModal.classList.remove('show');
                if (immediate) {
                    searchContainer.classList.add('hidden');
                    document.body.classList.remove('modal-open');
                    return;
                }
                setTimeout(() => {
                    searchContainer.classList.add('hidden');
                    document.body.classList.remove('modal-open');
                }, 400);
                return;
            }

            searchContainer.classList.add('hidden');
        };

        const openSearch = () => {
            searchContainer.classList.remove('hidden');

            if (window.innerWidth <= 780) {
                searchModal.classList.add('show');
                document.body.classList.add('modal-open');

                if (!this.searchSwipeBound && typeof window.addSwipeToCloseSimple === 'function' && searchBackground) {
                    this.searchSwipeBound = true;
                    window.addSwipeToCloseSimple(searchModal, searchBackground, () => closeSearch(true));
                }
            } else {
                searchModal.classList.add('show');
            }

            const searchInput = document.getElementById('search-input');
            if (searchInput) setTimeout(() => searchInput.focus(), 100);
        };

        searchButtons.forEach(btn => {
            if (btn.dataset.listenerAttached === 'true') return;
            btn.dataset.listenerAttached = 'true';
            btn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                openSearch();
            });
        });

        if (searchCancel) {
            searchCancel.addEventListener('click', (event) => {
                event.preventDefault();
                closeSearch();
            });
        }

        if (searchSubmit) {
            searchSubmit.addEventListener('click', (event) => {
                event.preventDefault();
                closeSearch();
            });
        }

        if (searchBackground) {
            searchBackground.addEventListener('click', (event) => {
                if (event.target === searchBackground) {
                    closeSearch();
                }
            });
        }
    }

    setupDatePicker() {
        const popup = document.getElementById('date-picker-popup');
        const prevBtn = document.getElementById('date-picker-prev');
        const nextBtn = document.getElementById('date-picker-next');
        const todayBtn = document.getElementById('date-picker-today');
        const clearBtn = document.getElementById('date-picker-clear');

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                this.datePickerDate.setMonth(this.datePickerDate.getMonth() - 1);
                this.renderDatePicker();
            });
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                this.datePickerDate.setMonth(this.datePickerDate.getMonth() + 1);
                this.renderDatePicker();
            });
        }
        if (todayBtn) {
            todayBtn.addEventListener('click', () => {
                this.datePickerDate = new Date();
                this.selectDatePickerDate(new Date());
            });
        }
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.selectDatePickerDate(null);
            });
        }

        document.addEventListener('click', (e) => {
            if (popup && !popup.contains(e.target) &&
                !e.target.classList.contains('due-date-cell') &&
                !e.target.classList.contains('date-picker-trigger')) {
                popup.style.display = 'none';
            }
        });
    }

    switchView(view) {
        this.currentView = view;

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === view);
        });

        const allView = document.getElementById('all-assignments-view');
        const calendarView = document.getElementById('by-due-date-view');

        if (allView) allView.style.display = view === 'all-assignments' ? 'block' : 'none';
        if (calendarView) calendarView.style.display = view === 'by-due-date' ? 'block' : 'none';

        if (view === 'by-due-date') {
            this.renderCalendarView();
        } else {
            this.renderTableView();
        }
    }

    renderAssignments() {
        if (this.currentView === 'by-due-date') {
            this.renderCalendarView();
        } else {
            this.renderTableView();
        }
    }

    getCoursesForSelectedSemester() {
        const selected = this.getSelectedSemester();
        if (!selected) return this.userCourses;

        return this.userCourses.filter(course =>
            String(course.year) === String(selected.year) &&
            String(course.term).toLowerCase() === String(selected.term).toLowerCase()
        );
    }

    getAssignmentsForSelectedSemester() {
        const selected = this.getSelectedSemester();
        if (!selected) return this.assignments;

        const selectedYear = String(selected.year);
        const selectedTerm = String(selected.term).toLowerCase();

        return this.assignments.filter(assignment => {
            if (assignment.course_year && assignment.course_term) {
                return String(assignment.course_year) === selectedYear &&
                    String(assignment.course_term).toLowerCase() === selectedTerm;
            }

            if (assignment.course_code) {
                const matches = this.userCourseSelections.filter(course => course.code === assignment.course_code);
                if (matches.length === 1) {
                    return String(matches[0].year) === selectedYear &&
                        String(matches[0].term).toLowerCase() === selectedTerm;
                }
            }

            return !assignment.course_code;
        });
    }

    renderTableView() {
        const tbody = document.getElementById('assignments-tbody');
        const emptyState = document.getElementById('assignments-empty');
        const tableWrapper = document.querySelector('.assignments-table-wrapper');

        if (!tbody) return;

        const assignmentsToShow = this.getAssignmentsForSelectedSemester();

        if (assignmentsToShow.length === 0) {
            if (tableWrapper) tableWrapper.style.display = 'none';
            if (emptyState) emptyState.style.display = 'flex';
            return;
        }

        if (tableWrapper) tableWrapper.style.display = 'block';
        if (emptyState) emptyState.style.display = 'none';

        tbody.innerHTML = assignmentsToShow.map(assignment => {
            const dueDateStr = assignment.due_date
                ? new Date(assignment.due_date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                })
                : '';

            const statusClass = `status-${assignment.status.replace('_', '-')}`;
            const statusText = this.getStatusText(assignment.status);

            const tagHtml = assignment.course_tag_name
                ? `<span class="course-tag" style="background-color: ${assignment.course_tag_color}">${assignment.course_tag_name}</span>`
                : '<span class="no-tag">-</span>';

            return `
                <tr class="assignment-row" data-id="${assignment.id}">
                    <td class="col-title">
                        <span class="assignment-icon">${assignment.assignment_icon || ''}</span>
                        <span class="assignment-title">${this.escapeHtml(assignment.title)}</span>
                    </td>
                    <td class="col-due-date due-date-cell" data-id="${assignment.id}">
                        ${dueDateStr || '<span class="no-date">Set date</span>'}
                    </td>
                    <td class="col-subject">
                        ${tagHtml}
                    </td>
                    <td class="col-status">
                        <span class="status-badge ${statusClass}">${statusText}</span>
                    </td>
                    <td class="col-actions">
                        <button class="action-btn delete-row-btn" data-id="${assignment.id}" title="Delete"><div class="assignment-delete-icon assignment-icons"></div></button>
                    </td>
                </tr>
            `;
        }).join('');

        tbody.querySelectorAll('.assignment-row').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.classList.contains('delete-row-btn') ||
                    e.target.closest('.delete-row-btn') ||
                    e.target.classList.contains('due-date-cell')) {
                    return;
                }
                const id = row.dataset.id;
                const assignment = assignmentsToShow.find(a => a.id === id) || this.assignments.find(a => a.id === id);
                if (assignment) {
                    this.openAssignmentModal(assignment);
                }
            });
        });

        tbody.querySelectorAll('.delete-row-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                this.deleteAssignment(id);
            });
        });

        tbody.querySelectorAll('.due-date-cell').forEach(cell => {
            cell.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = cell.dataset.id;
                const assignment = assignmentsToShow.find(a => a.id === id) || this.assignments.find(a => a.id === id);
                if (assignment) {
                    this.openDatePicker(cell, assignment);
                }
            });
        });
    }

    renderCalendarView() {
        const calendarBody = document.getElementById('calendar-body');
        const monthTitle = document.getElementById('calendar-month-title');

        if (!calendarBody) return;

        const year = this.calendarDate.getFullYear();
        const month = this.calendarDate.getMonth();

        if (monthTitle) {
            monthTitle.textContent = this.calendarDate.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long'
            });
        }

        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startPadding = firstDay.getDay();
        const totalDays = lastDay.getDate();

        const assignmentsByDate = {};
        const assignmentsToShow = this.getAssignmentsForSelectedSemester();
        assignmentsToShow.forEach(assignment => {
            if (assignment.due_date) {
                const dateKey = new Date(assignment.due_date).toDateString();
                if (!assignmentsByDate[dateKey]) {
                    assignmentsByDate[dateKey] = [];
                }
                assignmentsByDate[dateKey].push(assignment);
            }
        });

        let html = '';
        let dayCount = 1;
        const today = new Date().toDateString();

        const totalCells = startPadding + totalDays;
        const totalWeeks = Math.ceil(totalCells / 7);

        for (let week = 0; week < totalWeeks; week++) {
            html += '<div class="calendar-week">';
            for (let day = 0; day < 7; day++) {
                const cellIndex = week * 7 + day;

                if (cellIndex < startPadding || dayCount > totalDays) {
                    html += '<div class="calendar-cell empty"></div>';
                } else {
                    const currentDate = new Date(year, month, dayCount);
                    const dateKey = currentDate.toDateString();
                    const isToday = dateKey === today;
                    const dayAssignments = assignmentsByDate[dateKey] || [];

                    html += `
                        <div class="calendar-cell ${isToday ? 'today' : ''}">
                            <div class="day-number">${dayCount}</div>
                            <div class="day-assignments">
                                ${dayAssignments.slice(0, 3).map(a => `
                                    <div class="calendar-assignment" 
                                         style="background-color: ${a.course_tag_color || '#e0e0e0'}"
                                         data-id="${a.id}"
                                         title="${this.escapeHtml(a.title)}">
                                        ${this.truncateText(a.title, 15)}
                                    </div>
                                `).join('')}
                                ${dayAssignments.length > 3 ? `<div class="more-assignments">+${dayAssignments.length - 3} more</div>` : ''}
                            </div>
                        </div>
                    `;
                    dayCount++;
                }
            }
            html += '</div>';
        }

        calendarBody.innerHTML = html;

        calendarBody.querySelectorAll('.calendar-assignment').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = el.dataset.id;
                const assignment = this.assignments.find(a => a.id === id);
                if (assignment) {
                    this.openAssignmentModal(assignment);
                }
            });
        });
    }

    openAssignmentModal(assignment) {
        this.currentAssignment = assignment;
        this.isNewAssignment = false;
        this.previousView = this.currentView;

        const overlay = document.getElementById('assignment-modal-overlay');
        const titleInput = document.getElementById('assignment-modal-title');
        const dueDateInput = document.getElementById('assignment-modal-due-date');
        const statusSelect = document.getElementById('assignment-modal-status');
        const instructionsTextarea = document.getElementById('assignment-modal-instructions');
        const subjectTag = document.getElementById('subject-tag');
        const subjectDropdown = document.getElementById('subject-dropdown');
        const deleteBtn = document.getElementById('assignment-delete-btn');
        const emojiTrigger = document.getElementById('assignment-emoji-trigger');

        if (!overlay) return;

        if (deleteBtn) deleteBtn.style.display = 'block';

        if (titleInput) titleInput.value = assignment.title || '';
        if (dueDateInput && assignment.due_date) {
            dueDateInput.value = assignment.due_date.split('T')[0];
        } else if (dueDateInput) {
            dueDateInput.value = '';
        }
        if (statusSelect) statusSelect.value = assignment.status || 'not_started';
        if (instructionsTextarea) instructionsTextarea.value = assignment.instructions || '';
        if (!emojiTrigger) {
            console.warn('Assignments: emoji trigger not found in modal');
        }

        if (emojiTrigger) {
            const icon = assignment.assignment_icon || '';
            emojiTrigger.textContent = icon;
            emojiTrigger.dataset.emoji = icon;
        }

        if (subjectTag) {
            if (assignment.course_tag_name) {
                subjectTag.textContent = assignment.course_tag_name;
                subjectTag.style.backgroundColor = assignment.course_tag_color || '#666666';
                subjectTag.classList.add('has-tag');
                subjectTag.dataset.code = assignment.course_code || '';
                subjectTag.dataset.color = assignment.course_tag_color || '';
                subjectTag.dataset.year = assignment.course_year || '';
                subjectTag.dataset.term = assignment.course_term || '';
            } else {
                subjectTag.textContent = 'Select course';
                subjectTag.style.backgroundColor = '#e0e0e0';
                subjectTag.classList.remove('has-tag');
                subjectTag.dataset.code = '';
                subjectTag.dataset.color = '';
                subjectTag.dataset.year = '';
                subjectTag.dataset.term = '';
            }
        }

        this.populateSubjectDropdown(subjectDropdown, subjectTag);

        overlay.style.display = 'flex';
    }

    closeAssignmentModal() {
        const overlay = document.getElementById('assignment-modal-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
        this.currentAssignment = null;
        this.isNewAssignment = false;
        this.isSaving = false;
        const targetView = this.previousView || this.currentView || 'all-assignments';
        this.previousView = null;
        this.switchView(targetView);
        setTimeout(() => this.renderAssignments(), 0);
    }

    async saveCurrentAssignment() {
        if (this.isSaving || window._assignmentSaveInFlight) {
            console.log('Save already in progress, ignoring duplicate call');
            return;
        }
        this.isSaving = true;
        window._assignmentSaveInFlight = true;
        console.log('Saving assignment...');

        try {
            const titleInput = document.getElementById('assignment-modal-title');
            const dueDateInput = document.getElementById('assignment-modal-due-date');
            const statusSelect = document.getElementById('assignment-modal-status');
            const instructionsTextarea = document.getElementById('assignment-modal-instructions');
            const subjectTag = document.getElementById('subject-tag');
            const emojiTrigger = document.getElementById('assignment-emoji-trigger');
            const saveBtn = document.getElementById('assignment-save-btn');
            if (saveBtn) saveBtn.disabled = true;

            const courseCode = subjectTag?.dataset.code || null;
            const courseName = subjectTag?.classList.contains('has-tag') ? subjectTag.textContent : null;
            const courseColor = subjectTag?.dataset.color || '#666666';
            const courseYear = subjectTag?.dataset.year || null;
            const courseTerm = subjectTag?.dataset.term || null;

            const parsedDueDate = dueDateInput?.value ? this.parseDateFromInputValue(dueDateInput.value) : null;
            const normalizedDueDate = parsedDueDate ? this.normalizeDateForStorage(parsedDueDate) : null;

            const assignmentIcon = emojiTrigger?.dataset.emoji || '';

            const assignmentData = {
                title: titleInput?.value?.trim() || 'Untitled Assignment',
                due_date: normalizedDueDate ? normalizedDueDate.toISOString() : null,
                status: statusSelect?.value || 'not_started',
                instructions: instructionsTextarea?.value || '',
                course_code: courseCode || null,
                course_tag_name: courseName || null,
                course_tag_color: courseColor,
                course_year: courseYear || null,
                course_term: courseTerm || null,
                assignment_icon: assignmentIcon ? assignmentIcon : null
            };

            if (this.isNewAssignment || !this.currentAssignment) {
                const newAssignment = {
                    user_id: this.currentUser.id,
                    ...assignmentData
                };

                const { data, error } = await supabase
                    .from('assignments')
                    .insert([newAssignment])
                    .select()
                    .single();

                if (error) throw error;

                this.assignments.push(data);
                this.renderAssignments();
                console.log('Created new assignment:', data);
            } else {
                await this.updateAssignment(this.currentAssignment.id, assignmentData);
            }

            this.closeAssignmentModal();
        } catch (error) {
            console.error('Error saving assignment:', error);
            alert('Failed to save assignment. Please try again.');
            this.isSaving = false;
            const saveBtn = document.getElementById('assignment-save-btn');
            if (saveBtn) saveBtn.disabled = false;
        } finally {
            window._assignmentSaveInFlight = false;
        }
    }

    parseDateFromInputValue(value) {
        if (!value) return null;
        const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (dateOnlyMatch) {
            const year = Number(dateOnlyMatch[1]);
            const month = Number(dateOnlyMatch[2]) - 1;
            const day = Number(dateOnlyMatch[3]);
            const localDate = new Date(year, month, day);
            return Number.isNaN(localDate.getTime()) ? null : localDate;
        }
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    formatDateInputValue(date) {
        if (!date) return '';
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    normalizeDateForStorage(date) {
        if (!date) return null;
        return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
    }

    openDatePicker(targetElement, assignment, options = {}) {
        const popup = document.getElementById('date-picker-popup');
        if (!popup) return;

        const mode = options.mode || 'table';
        this.datePickerTarget = { element: targetElement, assignment, mode };

        if (mode === 'modal') {
            const inputDate = this.parseDateFromInputValue(targetElement?.value);
            if (inputDate) {
                this.datePickerDate = inputDate;
            } else if (assignment?.due_date) {
                this.datePickerDate = new Date(assignment.due_date);
            } else {
                this.datePickerDate = new Date();
            }
        } else if (assignment?.due_date) {
            this.datePickerDate = new Date(assignment.due_date);
        } else {
            this.datePickerDate = new Date();
        }

        const rect = targetElement.getBoundingClientRect();
        popup.style.top = `${rect.bottom + window.scrollY + 5}px`;
        popup.style.left = `${rect.left + window.scrollX}px`;
        popup.style.display = 'block';

        this.renderDatePicker();
    }

    renderDatePicker() {
        const daysContainer = document.getElementById('date-picker-days');
        const monthDisplay = document.getElementById('date-picker-month');
        const input = document.getElementById('date-picker-input');

        if (!daysContainer) return;

        const year = this.datePickerDate.getFullYear();
        const month = this.datePickerDate.getMonth();

        if (monthDisplay) {
            monthDisplay.textContent = this.datePickerDate.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short'
            });
        }

        const targetMode = this.datePickerTarget?.mode || 'table';
        const targetValueDate = targetMode === 'modal'
            ? this.parseDateFromInputValue(this.datePickerTarget?.element?.value)
            : (this.datePickerTarget?.assignment?.due_date ? new Date(this.datePickerTarget.assignment.due_date) : null);

        if (input && targetValueDate) {
            input.value = targetValueDate.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        } else if (input) {
            input.value = '';
        }

        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startPadding = firstDay.getDay();
        const totalDays = lastDay.getDate();
        const today = new Date().toDateString();
        const selectedDate = (targetValueDate || new Date()).toDateString();

        let html = '';

        for (let i = 0; i < startPadding; i++) {
            const prevMonthDay = new Date(year, month, -startPadding + i + 1);
            html += `<span class="date-picker-day other-month">${prevMonthDay.getDate()}</span>`;
        }

        for (let day = 1; day <= totalDays; day++) {
            const currentDate = new Date(year, month, day);
            const dateStr = currentDate.toDateString();
            const isToday = dateStr === today;
            const isSelected = dateStr === selectedDate;

            html += `<span class="date-picker-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" 
                           data-date="${this.formatDateInputValue(currentDate)}">${day}</span>`;
        }

        const remainingCells = (7 - ((startPadding + totalDays) % 7)) % 7;
        for (let i = 1; i <= remainingCells; i++) {
            html += `<span class="date-picker-day other-month">${i}</span>`;
        }

        daysContainer.innerHTML = html;

        daysContainer.querySelectorAll('.date-picker-day:not(.other-month)').forEach(dayEl => {
            dayEl.addEventListener('click', () => {
                const date = this.parseDateFromInputValue(dayEl.dataset.date);
                this.selectDatePickerDate(date);
            });
        });
    }

    async selectDatePickerDate(date) {
        const popup = document.getElementById('date-picker-popup');
        if (popup) popup.style.display = 'none';

        if (this.datePickerTarget?.mode === 'modal') {
            const targetInput = this.datePickerTarget.element;
            if (targetInput) {
                targetInput.value = date ? this.formatDateInputValue(date) : '';
            }
        } else if (this.datePickerTarget?.assignment) {
            const normalizedDate = date ? this.normalizeDateForStorage(date) : null;
            await this.updateAssignment(this.datePickerTarget.assignment.id, {
                due_date: normalizedDate ? normalizedDate.toISOString() : null
            });
        }

        this.datePickerTarget = null;
    }

    getStatusText(status) {
        const statusMap = {
            'not_started': 'Not Started',
            'ongoing': 'Ongoing',
            'completed': 'Completed'
        };
        return statusMap[status] || status;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    truncateText(text, maxLength) {
        if (!text) return '';
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }
}

let assignmentsManager = null;

function initializeAssignments() {
    const currentRoot = document.getElementById('assignments-main');
    if (!currentRoot) return;

    if (window._assignmentsInitializedRoot === currentRoot && (window._assignmentsInitInProgress || window._assignmentsInitialized)) {
        return;
    }

    if (assignmentsManager && assignmentsManager.root === currentRoot && (assignmentsManager.isInitialized || assignmentsManager.isInitializing)) {
        return;
    }

    // Create a fresh instance when DOM has been replaced (SPA navigation)
    window._assignmentsInitInProgress = true;
    assignmentsManager = new AssignmentsManager();
    assignmentsManager.init();
    window._assignmentsInitializedRoot = currentRoot;
    window._assignmentsInitialized = true;
    window._assignmentsInitInProgress = false;
}

// Only auto-initialize on direct page load (not SPA navigation)
if (document.getElementById('assignments-main')) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeAssignments);
    } else {
        initializeAssignments();
    }
}

export { initializeAssignments, AssignmentsManager };

window.initializeAssignments = initializeAssignments;
window.AssignmentsManager = AssignmentsManager;
