import { supabase } from "/supabase.js";
import { getCourseColorByType } from "/js/shared.js";

/**
 * Assignments Manager - Handles all assignment CRUD operations and UI
 */
class AssignmentsManager {
    constructor() {
        this.assignments = [];
        this.userCourses = [];
        this.currentAssignment = null;
        this.currentView = 'all-assignments';
        this.calendarDate = new Date();
        this.datePickerTarget = null;
        this.datePickerDate = new Date();
        this.isInitialized = false;
        this.isNewAssignment = false;
        this.eventListenersSetup = false;
        this.isSaving = false;
    }

    async init() {
        if (this.isInitialized) return;

        console.log('Assignments Manager: Starting initialization...');

        // Setup event listeners FIRST - these should always work
        this.setupEventListeners();

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
            console.log('Raw courses_selection:', coursesSelection);

            // Deduplicate course codes first
            const uniqueCourseCodes = [...new Set(coursesSelection.map(c => c.code))];
            console.log('Unique course codes:', uniqueCourseCodes);

            if (uniqueCourseCodes.length > 0) {
                const { data: coursesData, error: coursesError } = await supabase
                    .from('courses')
                    .select('course_code, title, type')
                    .in('course_code', uniqueCourseCodes);

                if (!coursesError && coursesData && coursesData.length > 0) {
                    // Deduplicate by course_code in case the query returns duplicates
                    const seenCodes = new Set();
                    this.userCourses = coursesData
                        .filter(course => {
                            if (seenCodes.has(course.course_code)) {
                                return false;
                            }
                            seenCodes.add(course.course_code);
                            return true;
                        })
                        .map(course => ({
                            code: course.course_code,
                            title: course.title,
                            type: course.type,
                            color: getCourseColorByType(course.type)
                        }));
                } else {
                    // Fallback with deduplication
                    const seenCodes = new Set();
                    this.userCourses = coursesSelection
                        .filter(course => {
                            if (seenCodes.has(course.code)) {
                                return false;
                            }
                            seenCodes.add(course.code);
                            return true;
                        })
                        .map(course => ({
                            code: course.code,
                            title: course.title || course.code,
                            type: course.type || 'General',
                            color: getCourseColorByType(course.type || 'General')
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

        const overlay = document.getElementById('assignment-modal-overlay');
        const titleInput = document.getElementById('assignment-modal-title');
        const dueDateInput = document.getElementById('assignment-modal-due-date');
        const statusSelect = document.getElementById('assignment-modal-status');
        const instructionsTextarea = document.getElementById('assignment-modal-instructions');
        const subjectTag = document.getElementById('subject-tag');
        const subjectDropdown = document.getElementById('subject-dropdown');
        const deleteBtn = document.getElementById('assignment-delete-btn');

        if (!overlay) return;

        if (titleInput) titleInput.value = '';
        if (dueDateInput) dueDateInput.value = '';
        if (statusSelect) statusSelect.value = 'not_started';
        if (instructionsTextarea) instructionsTextarea.value = '';

        if (deleteBtn) deleteBtn.style.display = 'none';

        if (subjectTag) {
            subjectTag.textContent = 'Select course';
            subjectTag.style.backgroundColor = '#e0e0e0';
            subjectTag.classList.remove('has-tag');
            subjectTag.dataset.code = '';
            subjectTag.dataset.color = '';
        }

        this.populateSubjectDropdown(subjectDropdown, subjectTag);

        overlay.style.display = 'flex';
    }

    populateSubjectDropdown(subjectDropdown, subjectTag) {
        if (!subjectDropdown) return;

        console.log('Populating dropdown with courses:', this.userCourses);

        subjectDropdown.innerHTML = `
            <div class="subject-option no-subject" data-code="" data-name="" data-color="">
                <span class="option-tag" style="background-color: #e0e0e0">None</span>
            </div>
            ${this.userCourses.map(course => `
                <div class="subject-option" 
                     data-code="${course.code}" 
                     data-name="${this.escapeHtml(course.title)}"
                     data-color="${course.color}">
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
                    } else {
                        subjectTag.textContent = 'Select course';
                        subjectTag.style.backgroundColor = '#e0e0e0';
                        subjectTag.classList.remove('has-tag');
                        subjectTag.dataset.code = '';
                        subjectTag.dataset.color = '';
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
        if (this.eventListenersSetup) {
            console.log('Event listeners already setup, skipping');
            return;
        }
        this.eventListenersSetup = true;
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

        this.setupDatePicker();
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
            if (popup && !popup.contains(e.target) && !e.target.classList.contains('due-date-cell')) {
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

    renderTableView() {
        const tbody = document.getElementById('assignments-tbody');
        const emptyState = document.getElementById('assignments-empty');
        const tableWrapper = document.querySelector('.assignments-table-wrapper');

        if (!tbody) return;

        if (this.assignments.length === 0) {
            if (tableWrapper) tableWrapper.style.display = 'none';
            if (emptyState) emptyState.style.display = 'flex';
            return;
        }

        if (tableWrapper) tableWrapper.style.display = 'block';
        if (emptyState) emptyState.style.display = 'none';

        tbody.innerHTML = this.assignments.map(assignment => {
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
                        <span class="assignment-icon">📄</span>
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
                        <button class="action-btn delete-row-btn" data-id="${assignment.id}" title="Delete">🗑️</button>
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
                const assignment = this.assignments.find(a => a.id === id);
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
                const assignment = this.assignments.find(a => a.id === id);
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
        this.assignments.forEach(assignment => {
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

        const overlay = document.getElementById('assignment-modal-overlay');
        const titleInput = document.getElementById('assignment-modal-title');
        const dueDateInput = document.getElementById('assignment-modal-due-date');
        const statusSelect = document.getElementById('assignment-modal-status');
        const instructionsTextarea = document.getElementById('assignment-modal-instructions');
        const subjectTag = document.getElementById('subject-tag');
        const subjectDropdown = document.getElementById('subject-dropdown');
        const deleteBtn = document.getElementById('assignment-delete-btn');

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

        if (subjectTag) {
            if (assignment.course_tag_name) {
                subjectTag.textContent = assignment.course_tag_name;
                subjectTag.style.backgroundColor = assignment.course_tag_color || '#666666';
                subjectTag.classList.add('has-tag');
                subjectTag.dataset.code = assignment.course_code || '';
                subjectTag.dataset.color = assignment.course_tag_color || '';
            } else {
                subjectTag.textContent = 'Select course';
                subjectTag.style.backgroundColor = '#e0e0e0';
                subjectTag.classList.remove('has-tag');
                subjectTag.dataset.code = '';
                subjectTag.dataset.color = '';
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
    }

    async saveCurrentAssignment() {
        if (this.isSaving) {
            console.log('Save already in progress, ignoring duplicate call');
            return;
        }
        this.isSaving = true;
        console.log('Saving assignment...');

        try {
            const titleInput = document.getElementById('assignment-modal-title');
            const dueDateInput = document.getElementById('assignment-modal-due-date');
            const statusSelect = document.getElementById('assignment-modal-status');
            const instructionsTextarea = document.getElementById('assignment-modal-instructions');
            const subjectTag = document.getElementById('subject-tag');

            const courseCode = subjectTag?.dataset.code || null;
            const courseName = subjectTag?.classList.contains('has-tag') ? subjectTag.textContent : null;
            const courseColor = subjectTag?.dataset.color || '#666666';

            const assignmentData = {
                title: titleInput?.value?.trim() || 'Untitled Assignment',
                due_date: dueDateInput?.value ? new Date(dueDateInput.value).toISOString() : null,
                status: statusSelect?.value || 'not_started',
                instructions: instructionsTextarea?.value || '',
                course_code: courseCode || null,
                course_tag_name: courseName || null,
                course_tag_color: courseColor
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
        }
    }

    openDatePicker(targetElement, assignment) {
        const popup = document.getElementById('date-picker-popup');
        if (!popup) return;

        this.datePickerTarget = { element: targetElement, assignment };

        if (assignment.due_date) {
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

        if (input && this.datePickerTarget?.assignment?.due_date) {
            input.value = new Date(this.datePickerTarget.assignment.due_date).toLocaleDateString('en-US', {
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
        const selectedDate = this.datePickerTarget?.assignment?.due_date
            ? new Date(this.datePickerTarget.assignment.due_date).toDateString()
            : null;

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
                           data-date="${currentDate.toISOString()}">${day}</span>`;
        }

        const remainingCells = (7 - ((startPadding + totalDays) % 7)) % 7;
        for (let i = 1; i <= remainingCells; i++) {
            html += `<span class="date-picker-day other-month">${i}</span>`;
        }

        daysContainer.innerHTML = html;

        daysContainer.querySelectorAll('.date-picker-day:not(.other-month)').forEach(dayEl => {
            dayEl.addEventListener('click', () => {
                const date = new Date(dayEl.dataset.date);
                this.selectDatePickerDate(date);
            });
        });
    }

    async selectDatePickerDate(date) {
        const popup = document.getElementById('date-picker-popup');
        if (popup) popup.style.display = 'none';

        if (this.datePickerTarget?.assignment) {
            await this.updateAssignment(this.datePickerTarget.assignment.id, {
                due_date: date ? date.toISOString() : null
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
    // Always create a fresh instance when called via router navigation
    // This ensures event listeners are attached to the new DOM elements
    // after the page content is replaced by SPA navigation
    assignmentsManager = new AssignmentsManager();
    assignmentsManager.init();
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
