import { supabase } from "../supabase.js";
import { fetchAvailableSemesters, fetchCourseData, getCourseColorByType, formatProfessorDisplayName, openConfirmModal, showGlobalToast } from "./shared.js";
import { applyPreferredTermToGlobals, normalizeTermValue, resolvePreferredTermForAvailableSemesters, setPreferredTermValue } from "./preferences.js";
import { openSemesterMobileSheet, closeSemesterMobileSheet } from "./semester-mobile-sheet.js";

const OPEN_ASSIGNMENT_INTENT_KEY = 'ila_open_assignment_id';

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
        this.selectedCalendarDate = null;
        this.datePickerTarget = null;
        this.datePickerDate = new Date();
        this.isInitialized = false;
        this.isInitializing = false;
        this.isNewAssignment = false;
        this.eventListenersSetup = false;
        this.isSaving = false;
        this.filterCloseTimer = null;
        this.assignmentsFilterSwipeBound = false;
        this.activeAssignmentsFilterTrigger = null;
        this.assignmentActionsSheetState = null;
        this.calendarDaySheetState = null;
        this.assignmentDueDateSheetState = null;
        this.courseNameDisplayMaxLength = 18;
        this.courseNameDisplayMaxLengthMobile = 32;
        this.courseNameDisplayMaxLengthDesktop = 18;
        this.coursePrefilter = this.readCoursePrefilterFromURL();
        this.quickFilter = 'all';
        this.searchQuery = '';
        this.sortKey = 'due_date_asc';
        this.advancedFilters = {
            has_due_date: false,
            no_due_date: false,
            with_course: false,
            without_course: false
        };
        this.sortOptions = {
            due_date_asc: 'Due date',
            due_date_desc: 'Due date',
            title_az: 'Title A-Z'
        };
        this.statusConfig = {
            not_started: {
                key: 'not_started',
                label: 'Not Started',
                className: 'status-not-started',
                colors: { background: '#e9ecef', text: '#6c757d' }
            },
            in_progress: {
                key: 'in_progress',
                label: 'In Progress',
                className: 'status-in-progress',
                colors: { background: '#fff3cd', text: '#856404' }
            },
            completed: {
                key: 'completed',
                label: 'Completed',
                className: 'status-completed',
                colors: { background: '#d4edda', text: '#155724' }
            },
            overdue: {
                key: 'overdue',
                label: 'Overdue',
                className: 'status-overdue',
                colors: { background: '#fee2e2', text: '#b91c1c' }
            }
        };
        this.statusAliases = {
            not_started: 'not_started',
            in_progress: 'in_progress',
            ongoing: 'in_progress',
            completed: 'completed'
        };
        this.emojiRecentStorageKey = 'assignments_recent_emojis_v1';
        this.emojiRecentLimit = 24;
        this.emojiActiveCategory = 'people';
        this.toolbarScrollBound = false;
        this.toolbarScrollRafId = 0;
        this.emojiCategoryDefinitions = [
            { id: 'recent', label: 'Recent', icon: '🕒', keywords: 'recent history clock' },
            { id: 'people', label: 'People', icon: '😀', keywords: 'face smile people emotion' },
            { id: 'nature', label: 'Nature', icon: '🍃', keywords: 'nature plant weather animal' },
            { id: 'food', label: 'Food', icon: '🥕', keywords: 'food meal drink' },
            { id: 'activities', label: 'Activities', icon: '⚽', keywords: 'sport game activity' },
            { id: 'travel', label: 'Travel', icon: '✈️', keywords: 'travel place transport' },
            { id: 'objects', label: 'Objects', icon: '💡', keywords: 'object idea tool school' },
            { id: 'symbols', label: 'Symbols', icon: '✅', keywords: 'symbol mark status' },
            { id: 'flags', label: 'Flags', icon: '🏁', keywords: 'flag finish country' }
        ];
        this.emojiCatalogByCategory = {
            people: ['😀', '😁', '😂', '🤣', '😊', '😉', '😍', '😎', '🥳', '🤓', '🤔', '😴', '😭', '😡', '😅', '🤯', '😇', '🤩', '😌', '😬'],
            nature: ['🌱', '🍀', '🌿', '🍃', '🌸', '🌼', '🌻', '🌺', '🌳', '🌈', '☀️', '🌙', '⭐', '🔥', '💧', '⚡', '🦋', '🐶', '🐱', '🐝'],
            food: ['🍎', '🍌', '🍇', '🍓', '🥑', '🥕', '🌽', '🍕', '🍔', '🍟', '🍜', '🍣', '🍩', '🍪', '☕', '🍵', '🍰', '🍫', '🥨', '🍿'],
            activities: ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🎯', '🎮', '🎲', '🏋️‍♀️', '🏃‍♀️', '🏊‍♂️', '🚴‍♂️', '🎵', '🎬', '🧩', '🥇', '🏆', '🎨', '🎤'],
            travel: ['🚗', '🚌', '🚆', '🚲', '✈️', '🚀', '🗺️', '🧭', '🏖️', '🏔️', '🏙️', '🏠', '📍', '⛽', '🛴', '🚢', '🚇', '🧳', '🛫', '🛬'],
            objects: ['💡', '📚', '📖', '🧠', '💻', '⌨️', '📱', '🔋', '📌', '✏️', '🖊️', '📎', '📐', '🧮', '🔒', '🕒', '🧪', '🗂️', '📅', '📝', '📄'],
            symbols: ['✅', '❌', '⚠️', '❗', '❓', '💯', '❤️', '💙', '⭐', '✔️', '➕', '➖', '➡️', '⬅️', '⬆️', '⬇️', '♻️', '🔔', '🔲', '➰'],
            flags: ['🏁', '🚩', '🏳️', '🏴', '🏳️‍🌈', '🇺🇸', '🇯🇵', '🇬🇧', '🇫🇷', '🇩🇪', '🇪🇸', '🇮🇹', '🇨🇦', '🇧🇷', '🇰🇷', '🇦🇺', '🇲🇽', '🇮🇳', '🇺🇦', '🇸🇪']
        };
        this.emojiKeywordsByValue = {
            '😀': 'smile happy grin face', '😁': 'grin smile happy', '😂': 'laugh tears funny', '🤣': 'rofl laugh funny',
            '😊': 'smile blush happy', '😉': 'wink playful', '😍': 'love heart eyes', '😎': 'cool sunglasses',
            '🥳': 'party celebration birthday', '🤓': 'nerd study smart', '🤔': 'thinking question', '😴': 'sleep tired',
            '😭': 'cry sad', '😡': 'angry mad', '😅': 'sweat relief', '🤯': 'mind blown shocked', '😇': 'angel halo',
            '🤩': 'star struck excited', '😌': 'calm relieved', '😬': 'grimace awkward',
            '🌱': 'sprout plant', '🍀': 'clover luck', '🌿': 'herb leaf', '🍃': 'leaf wind', '🌸': 'cherry blossom flower',
            '🌼': 'flower blossom', '🌻': 'sunflower', '🌺': 'hibiscus flower', '🌳': 'tree', '🌈': 'rainbow',
            '☀️': 'sun weather', '🌙': 'moon night', '⭐': 'star', '🔥': 'fire hot', '💧': 'water drop',
            '⚡': 'lightning electric', '🦋': 'butterfly', '🐶': 'dog pet', '🐱': 'cat pet', '🐝': 'bee insect',
            '🍎': 'apple fruit', '🍌': 'banana fruit', '🍇': 'grapes fruit', '🍓': 'strawberry fruit', '🥑': 'avocado',
            '🥕': 'carrot vegetable', '🌽': 'corn vegetable', '🍕': 'pizza slice', '🍔': 'burger hamburger',
            '🍟': 'fries chips', '🍜': 'ramen noodles', '🍣': 'sushi', '🍩': 'donut', '🍪': 'cookie',
            '☕': 'coffee drink', '🍵': 'tea drink', '🍰': 'cake dessert', '🍫': 'chocolate', '🥨': 'pretzel', '🍿': 'popcorn',
            '⚽': 'soccer football', '🏀': 'basketball', '🏈': 'american football', '⚾': 'baseball', '🎾': 'tennis',
            '🏐': 'volleyball', '🎯': 'target dart', '🎮': 'video game', '🎲': 'dice game', '🏋️‍♀️': 'weightlifting gym',
            '🏃‍♀️': 'running', '🏊‍♂️': 'swimming', '🚴‍♂️': 'cycling bike', '🎵': 'music note', '🎬': 'movie film',
            '🧩': 'puzzle', '🥇': 'gold medal first', '🏆': 'trophy winner', '🎨': 'paint art', '🎤': 'microphone sing',
            '🚗': 'car vehicle', '🚌': 'bus', '🚆': 'train', '🚲': 'bicycle bike', '✈️': 'airplane flight',
            '🚀': 'rocket space', '🗺️': 'map', '🧭': 'compass', '🏖️': 'beach', '🏔️': 'mountain',
            '🏙️': 'city skyline', '🏠': 'home house', '📍': 'pin location', '⛽': 'gas fuel', '🛴': 'scooter',
            '🚢': 'ship boat', '🚇': 'metro subway', '🧳': 'luggage suitcase', '🛫': 'departure takeoff', '🛬': 'arrival landing',
            '💡': 'idea light bulb', '📚': 'books study', '📖': 'book read', '🧠': 'brain think', '💻': 'laptop computer',
            '⌨️': 'keyboard', '📱': 'phone mobile', '🔋': 'battery', '📌': 'pin pushpin', '✏️': 'pencil',
            '🖊️': 'pen', '📎': 'paperclip clip', '📐': 'ruler geometry', '🧮': 'abacus math', '🔒': 'lock secure',
            '🕒': 'time clock', '🧪': 'lab science test', '🗂️': 'folder files', '📅': 'calendar date', '📝': 'memo note writing',
            '📄': 'document page paper assignment',
            '✅': 'check success done', '❌': 'cross x cancel', '⚠️': 'warning alert', '❗': 'exclamation important',
            '❓': 'question help', '💯': 'hundred perfect', '❤️': 'heart love red', '💙': 'heart love blue',
            '✔️': 'check mark', '➕': 'plus add', '➖': 'minus subtract', '➡️': 'right arrow', '⬅️': 'left arrow',
            '⬆️': 'up arrow', '⬇️': 'down arrow', '♻️': 'recycle', '🔔': 'bell notification', '🔲': 'square',
            '➰': 'loop', '🏁': 'finish flag', '🚩': 'red flag', '🏳️': 'white flag', '🏴': 'black flag',
            '🏳️‍🌈': 'rainbow pride flag'
        };
        this.emojiRecentEmojis = this.loadRecentEmojis();
        if (this.emojiRecentEmojis.length > 0) {
            this.emojiActiveCategory = 'recent';
        }
    }

    consumeOpenNewAssignmentIntent() {
        try {
            const shouldOpen = sessionStorage.getItem('open_new_assignment_modal') === '1';
            if (shouldOpen) {
                sessionStorage.removeItem('open_new_assignment_modal');
            }
            return shouldOpen;
        } catch (error) {
            console.warn('Unable to read assignment quick-action intent:', error);
            return false;
        }
    }

    consumeOpenAssignmentIntent() {
        try {
            const assignmentId = String(sessionStorage.getItem(OPEN_ASSIGNMENT_INTENT_KEY) || '').trim();
            if (assignmentId) {
                sessionStorage.removeItem(OPEN_ASSIGNMENT_INTENT_KEY);
            }
            return assignmentId;
        } catch (error) {
            console.warn('Unable to read assignment open intent:', error);
            return '';
        }
    }

    hasAssignmentById(assignmentId) {
        const normalizedId = String(assignmentId || '').trim();
        if (!normalizedId) return false;
        return this.assignments.some((item) => String(item?.id || '').trim() === normalizedId);
    }

    readCoursePrefilterFromURL() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            const courseCode = (params.get('courseCode') || params.get('course_code') || '').trim();
            const year = (params.get('year') || '').trim();
            const term = (params.get('term') || '').trim();
            const courseTitle = (params.get('courseTitle') || '').trim();

            if (!courseCode) return null;

            return {
                courseCode,
                normalizedCourseCode: courseCode.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                year: year || null,
                term: term || null,
                courseTitle: courseTitle || null
            };
        } catch (error) {
            console.warn('Unable to read assignment course prefilter from URL:', error);
            return null;
        }
    }

    matchesCoursePrefilter(assignment) {
        if (!this.coursePrefilter) return true;

        const normalizeCode = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const normalizeTerm = (value) => String(value || '').trim().toLowerCase();
        const normalizeYear = (value) => String(value || '').trim();

        if (normalizeCode(assignment?.course_code) !== this.coursePrefilter.normalizedCourseCode) {
            return false;
        }

        const prefilterYear = normalizeYear(this.coursePrefilter.year);
        const prefilterTerm = normalizeTerm(this.coursePrefilter.term);

        if (!prefilterYear && !prefilterTerm) {
            return true;
        }

        if (assignment?.course_year || assignment?.course_term) {
            const yearMatches = !prefilterYear || normalizeYear(assignment.course_year) === prefilterYear;
            const termMatches = !prefilterTerm || normalizeTerm(assignment.course_term) === prefilterTerm;
            return yearMatches && termMatches;
        }

        const matchingSelections = (this.userCourseSelections || []).filter((course) =>
            normalizeCode(course?.code) === this.coursePrefilter.normalizedCourseCode
        );

        if (!matchingSelections.length) {
            return true;
        }

        return matchingSelections.some((course) => {
            const yearMatches = !prefilterYear || normalizeYear(course?.year) === prefilterYear;
            const termMatches = !prefilterTerm || normalizeTerm(course?.term) === prefilterTerm;
            return yearMatches && termMatches;
        });
    }

    async init() {
        if (this.isInitialized || this.isInitializing) return;
        this.isInitializing = true;

        try {
            console.log('Assignments Manager: Starting initialization...');
            const shouldOpenNewAssignment = this.consumeOpenNewAssignmentIntent();
            const openAssignmentId = this.consumeOpenAssignmentIntent();

            // Setup event listeners FIRST - these should always work
            this.setupEventListeners();

            await this.setupContainerAbove();

            // Check authentication
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.user) {
                console.log('User not authenticated, assignments data not loaded (but UI is ready)');
                if (shouldOpenNewAssignment) {
                    await this.openNewAssignmentModal();
                }
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
            const handledHashRoute = this.handleHashURL();
            const handledOpenAssignmentIntent = !handledHashRoute && this.hasAssignmentById(openAssignmentId);
            if (handledOpenAssignmentIntent) {
                await this.openAssignmentById(openAssignmentId);
            }
            if (!handledHashRoute && !handledOpenAssignmentIntent && openAssignmentId) {
                console.warn('Assignment not found for stored home navigation intent:', openAssignmentId);
            }
            if (!handledHashRoute && !handledOpenAssignmentIntent && shouldOpenNewAssignment) {
                await this.openNewAssignmentModal();
            }
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

            this.openAssignmentById(assignmentId);

            // Clear the hash to avoid reopening on refresh (preserve query params, including course prefilter)
            window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
            return true;
        }

        return false;
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

            this.assignments = (data || []).map((assignment) => this.normalizeAssignmentRecord(assignment));
            console.log('Loaded assignments:', this.assignments.length);
        } catch (error) {
            console.error('Error loading assignments:', error);
            this.assignments = [];
        }
    }

    async openNewAssignmentModal(options = {}) {
        if (!this.currentUser) {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.user) {
                if (window.authManager && window.authManager.showLoginModal) {
                    window.authManager.showLoginModal('create an assignment');
                    return;
                }
                showGlobalToast('Please log in to create assignments.');
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
        const subjectSelector = document.getElementById('assignment-modal-subject');
        const subjectDropdown = document.getElementById('subject-dropdown');
        const subjectCurrent = document.getElementById('subject-current');
        const deleteBtn = document.getElementById('assignment-delete-btn');
        const emojiTrigger = document.getElementById('assignment-emoji-trigger');
        const saveBtn = document.getElementById('assignment-save-btn');
        const subtitleNode = document.getElementById('assignment-modal-subtitle');

        if (!overlay) return;
        overlay.dataset.assignmentId = '';
        overlay.dataset.assignmentMode = 'new';
        if (saveBtn) saveBtn.disabled = false;
        if (saveBtn) saveBtn.textContent = 'Create Assignment';

        if (titleInput) titleInput.value = '';
        const prefillDate = options?.dueDate ? this.getDateOnly(options.dueDate) : null;
        if (dueDateInput) dueDateInput.value = this.formatDateInputValue(prefillDate || new Date());
        if (statusSelect) {
            statusSelect.value = 'not_started';
            statusSelect.dispatchEvent(new Event('change', { bubbles: true }));
            this.updateStatusSelectorAppearance(statusSelect.value);
        }
        if (instructionsTextarea) instructionsTextarea.value = '';
        if (emojiTrigger) {
            emojiTrigger.textContent = '📄';
            emojiTrigger.dataset.emoji = '📄';
        }

        if (deleteBtn) deleteBtn.style.display = 'none';
        if (subtitleNode) {
            subtitleNode.textContent = 'New assignment';
            subtitleNode.hidden = false;
        }

        if (subjectTag) {
            subjectTag.textContent = 'Select course';
            subjectTag.style.backgroundColor = '';
            subjectTag.classList.remove('has-tag');
            subjectTag.dataset.code = '';
            subjectTag.dataset.color = '';
            subjectTag.dataset.year = '';
            subjectTag.dataset.term = '';
            subjectTag.dataset.fullName = '';
        }

        this.updateSubjectSelectorAppearance(subjectTag, subjectSelector);

        if (subjectSelector) subjectSelector.classList.remove('open');
        if (subjectCurrent) subjectCurrent.classList.remove('open');

        this.populateSubjectDropdown(subjectDropdown, subjectTag);

        closeSemesterMobileSheet({ immediate: true });
        this.closeAssignmentDueDateSheet({ immediate: true, restoreFocus: false });
        overlay.style.display = 'flex';
        document.body.classList.add('assignment-modal-open');
        if (titleInput) {
            window.requestAnimationFrame(() => titleInput.focus());
        }
    }

    populateSubjectDropdown(subjectDropdown, subjectTag) {
        if (!subjectDropdown) return;

        const coursesForSemester = this.getCoursesForSelectedSemester();
        const selectedCode = subjectTag?.dataset.code || '';
        const subjectSelect = document.getElementById('assignment-modal-course-select');
        console.log('Populating dropdown with courses:', coursesForSemester);

        if (subjectSelect) {
            subjectSelect.innerHTML = `
                <option value="">None</option>
                ${coursesForSemester.map(course => `
                    <option value="${this.escapeHtml(course.code || '')}" data-color="${this.escapeHtml(course.color || '')}">
                        ${this.escapeHtml(course.title || course.code || '')}
                    </option>
                `).join('')}
            `;
            subjectSelect.value = selectedCode;
            if (subjectSelect.value !== selectedCode) {
                subjectSelect.value = '';
            }
        }

        subjectDropdown.innerHTML = `
            <div class="subject-option no-subject${!selectedCode ? ' selected' : ''}" data-code="" data-name="" data-color="">
                <span class="option-tag" style="background-color: #e0e0e0">None</span>
            </div>
            ${coursesForSemester.map(course => `
                <div class="subject-option${selectedCode === course.code ? ' selected' : ''}" 
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
                this.applySubjectSelection({
                    code: option.dataset.code || '',
                    name: option.dataset.name || '',
                    color: option.dataset.color || '',
                    year: option.dataset.year || '',
                    term: option.dataset.term || ''
                }, {
                    subjectTag,
                    subjectDropdown
                });
            });
        });
    }

    async updateAssignment(id, updates) {
        try {
            const payload = { ...updates, updated_at: new Date().toISOString() };
            if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
                payload.status = this.getDatabaseStatus(payload.status);
            }
            const { data, error } = await supabase
                .from('assignments')
                .update(payload)
                .eq('id', id)
                .eq('user_id', this.currentUser.id)
                .select()
                .single();

            if (error) throw error;

            const index = this.assignments.findIndex(a => a.id === id);
            if (index !== -1) {
                this.assignments[index] = this.normalizeAssignmentRecord(data);
            }

            this.renderAssignments();
            return data;
        } catch (error) {
            console.error('Error updating assignment:', error);
            showGlobalToast('Failed to update assignment. Please try again.');
            return null;
        }
    }

    async deleteAssignment(id) {
        const targetAssignment = this.assignments.find((assignment) => String(assignment?.id) === String(id));
        const assignmentTitle = String(targetAssignment?.title || '').trim();
        const shouldDelete = await openConfirmModal({
            title: 'Delete Assignment',
            message: assignmentTitle
                ? `Are you sure you want to delete "${assignmentTitle}"? This action cannot be undone.`
                : 'Are you sure you want to delete this assignment? This action cannot be undone.',
            confirmLabel: 'Delete Assignment',
            cancelLabel: 'Cancel',
            destructive: true
        });

        if (!shouldDelete) {
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
            showGlobalToast('Failed to delete assignment. Please try again.');
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

        document.querySelectorAll('.assignments-view-segment[data-view]').forEach(btn => {
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

        document.querySelectorAll('.assignment-quick-filter').forEach((button) => {
            button.addEventListener('click', () => {
                this.setQuickFilter(button.dataset.filter || 'all');
            });
        });

        document.querySelectorAll('.assignment-summary-card[data-filter]').forEach((card) => {
            card.addEventListener('click', () => {
                this.setQuickFilter(card.dataset.filter || 'all');
            });
        });

        ['search-pill-input', 'search-input'].forEach((id) => {
            const input = document.getElementById(id);
            if (!input) return;
            input.addEventListener('input', (event) => {
                const value = event.target.value || '';
                this.searchQuery = value.trim();
                this.syncSearchInputs(value, id);
                this.renderAssignments();
            });
        });

        this.setupSortControls();
        this.setupFilterControls();
        this.setupAssignmentsListInteractions();
        this.setupToolbarScrollState();

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

        const cancelBtn = document.getElementById('assignment-modal-cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.closeAssignmentModal();
            });
        }

        const emojiTrigger = document.getElementById('assignment-emoji-trigger');
        const emojiPicker = document.getElementById('assignment-emoji-picker');
        const emojiSearch = document.getElementById('assignment-emoji-search');
        const emojiRandom = document.getElementById('assignment-emoji-random');
        const emojiPreview = document.getElementById('assignment-emoji-preview');
        const emojiRemove = document.getElementById('assignment-emoji-remove');
        if (emojiTrigger && emojiPicker) {
            this.renderEmojiPicker(emojiPicker, { preserveSearch: false });

            const showEmojiPickerPopup = () => {
                this.renderEmojiPicker(emojiPicker, { preserveSearch: false });
                emojiPicker.style.display = 'flex';
                emojiPicker.dataset.hideToken = '';

                requestAnimationFrame(() => {
                    emojiPicker.classList.add('open');
                });
            };

            const hideEmojiPickerPopup = ({ immediate = false } = {}) => {
                if (immediate) {
                    emojiPicker.classList.remove('open');
                    emojiPicker.style.display = 'none';
                    emojiPicker.dataset.hideToken = '';
                    return;
                }

                if (emojiPicker.style.display === 'none' || emojiPicker.style.display === '') {
                    return;
                }

                const hideToken = `${Date.now()}`;
                emojiPicker.dataset.hideToken = hideToken;
                emojiPicker.classList.remove('open');

                const finishHide = () => {
                    if (emojiPicker.dataset.hideToken !== hideToken) return;
                    if (!emojiPicker.classList.contains('open')) {
                        emojiPicker.style.display = 'none';
                    }
                };

                emojiPicker.addEventListener('transitionend', finishHide, { once: true });
                window.setTimeout(finishHide, 240);
            };

            const selectEmoji = (emojiValue) => {
                if (!emojiValue) return;
                emojiTrigger.textContent = emojiValue;
                emojiTrigger.dataset.emoji = emojiValue;
                this.addRecentEmoji(emojiValue);
                hideEmojiPickerPopup();
            };

            emojiTrigger.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const isOpen = emojiPicker.classList.contains('open');
                if (isOpen) {
                    hideEmojiPickerPopup();
                } else {
                    this.closeModalSelectorPanels({ keep: 'emoji' });
                    showEmojiPickerPopup();
                }
            });

            emojiPicker.addEventListener('click', (e) => {
                const categoryButton = e.target.closest('.emoji-category-btn');
                if (categoryButton) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.setEmojiPickerCategory(categoryButton.dataset.category, emojiPicker, { preserveSearch: true });
                    return;
                }

                const emojiButton = e.target.closest('.emoji-option');
                if (!emojiButton) return;
                const emojiValue = emojiButton.dataset.emoji || emojiButton.textContent;
                selectEmoji(emojiValue);
            });

            if (emojiSearch) {
                emojiSearch.addEventListener('input', () => {
                    this.filterEmojiPickerOptions(emojiPicker, emojiSearch.value);
                });
            }

            if (emojiRandom) {
                emojiRandom.addEventListener('click', () => {
                    const activeSection = emojiPicker.querySelector('.emoji-picker-section.active');
                    if (!activeSection) return;
                    const buttons = Array.from(activeSection.querySelectorAll('.emoji-option')).filter(btn => btn.style.display !== 'none');
                    if (buttons.length === 0) return;
                    const randomButton = buttons[Math.floor(Math.random() * buttons.length)];
                    const emojiValue = randomButton.dataset.emoji || randomButton.textContent;
                    selectEmoji(emojiValue);
                });
            }

            if (emojiPreview) {
                emojiPicker.addEventListener('mouseover', (event) => {
                    const target = event.target.closest('button');
                    if (target && target.classList.contains('emoji-option')) {
                        const emojiValue = target.dataset.emoji || target.textContent;
                        if (emojiValue) {
                            emojiPreview.textContent = emojiValue;
                        }
                    }
                });
            }

            if (emojiRemove) {
                emojiRemove.addEventListener('click', () => {
                    emojiTrigger.textContent = '';
                    emojiTrigger.dataset.emoji = '';
                    hideEmojiPickerPopup();
                });
            }

            document.addEventListener('click', (e) => {
                if (!emojiPicker.contains(e.target) && !emojiTrigger.contains(e.target)) {
                    hideEmojiPickerPopup();
                }
            });
        }

        const deleteBtn = document.getElementById('assignment-delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async () => {
                if (this.currentAssignment) {
                    await this.deleteAssignment(this.currentAssignment.id);
                }
            });
        }

        const subjectCurrent = document.getElementById('subject-current');
        const subjectDropdown = document.getElementById('subject-dropdown');
        const subjectSelector = document.getElementById('assignment-modal-subject');
        const subjectSelect = document.getElementById('assignment-modal-course-select');

        if (subjectSelect && subjectSelect.dataset.listenerAttached !== 'true') {
            subjectSelect.dataset.listenerAttached = 'true';
            subjectSelect.addEventListener('change', () => {
                const selectedCode = String(subjectSelect.value || '');
                const coursesForSemester = this.getCoursesForSelectedSemester();
                const selectedCourse = coursesForSemester.find((course) => String(course.code || '') === selectedCode);
                this.applySubjectSelection(selectedCourse
                    ? {
                        code: selectedCourse.code || '',
                        name: selectedCourse.title || selectedCourse.code || '',
                        color: selectedCourse.color || '',
                        year: selectedCourse.year || '',
                        term: selectedCourse.term || ''
                    }
                    : {
                        code: '',
                        name: '',
                        color: '',
                        year: '',
                        term: ''
                    });
            });
        }

        if (subjectCurrent && subjectDropdown && subjectSelector) {
            // Clone the element to remove any existing event listeners
            const newSubjectCurrent = subjectCurrent.cloneNode(true);
            subjectCurrent.parentNode.replaceChild(newSubjectCurrent, subjectCurrent);

            newSubjectCurrent.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const mobileSubjectSelect = document.getElementById('assignment-modal-course-select');
                if (this.isMobileViewport() && mobileSubjectSelect) {
                    this.closeModalSelectorPanels({ keep: 'mobile-select' });
                    openSemesterMobileSheet({
                        targetSelect: mobileSubjectSelect,
                        force: true,
                        title: 'Course',
                        description: 'Select assignment course'
                    });
                    return;
                }

                const dropdown = document.getElementById('subject-dropdown');
                const selector = document.getElementById('assignment-modal-subject');
                if (!dropdown) return;
                if (!selector) return;
                const shouldOpen = !selector.classList.contains('open');
                this.closeModalSelectorPanels({ keep: shouldOpen ? 'subject' : null });
                selector.classList.toggle('open', shouldOpen);
                newSubjectCurrent.classList.toggle('open', shouldOpen);
            });

            // Only add document click listener once globally to prevent duplicates
            if (!window._assignmentDropdownCloseHandlerAdded) {
                window._assignmentDropdownCloseHandlerAdded = true;
                document.addEventListener('click', (e) => {
                    const dropdown = document.getElementById('subject-dropdown');
                    const current = document.getElementById('subject-current');
                    const selector = document.getElementById('assignment-modal-subject');
                    if (dropdown && current && selector && !selector.contains(e.target) && !dropdown.contains(e.target)) {
                        selector.classList.remove('open');
                        current.classList.remove('open');
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
                this.renderCalendarView({ resetSelection: true });
            });
        }

        const modalDueDateInput = document.getElementById('assignment-modal-due-date');
        if (modalDueDateInput) {
            modalDueDateInput.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this.isMobileViewport()) {
                    this.closeModalSelectorPanels({ keep: 'date-sheet' });
                    this.openAssignmentDueDateSheet(modalDueDateInput);
                    return;
                }
                this.closeModalSelectorPanels({ keep: 'date' });
                this.openDatePicker(modalDueDateInput, this.currentAssignment, { mode: 'modal' });
            });
        }

        this.setupDatePicker();
    }

    setupToolbarScrollState() {
        if (this.toolbarScrollBound) return;
        this.toolbarScrollBound = true;

        const toolbarShell = this.root?.querySelector('.assignments-toolbar-shell');
        if (!toolbarShell) return;

        const appContent = document.getElementById('app-content');
        const getScrollTop = () => {
            const windowScrollY = window.scrollY || window.pageYOffset || 0;
            const rootScrollY = document.documentElement?.scrollTop || 0;
            const bodyScrollY = document.body?.scrollTop || 0;
            const contentScrollY = appContent ? appContent.scrollTop : 0;
            return Math.max(windowScrollY, rootScrollY, bodyScrollY, contentScrollY);
        };

        const applyScrollState = () => {
            this.toolbarScrollRafId = 0;
            toolbarShell.classList.toggle('is-scrolled', getScrollTop() > 0);
        };

        const requestApply = () => {
            if (this.toolbarScrollRafId) return;
            this.toolbarScrollRafId = window.requestAnimationFrame(applyScrollState);
        };

        window.addEventListener('scroll', requestApply, { passive: true });
        appContent?.addEventListener('scroll', requestApply, { passive: true });
        document.addEventListener('scroll', requestApply, { passive: true, capture: true });
        window.addEventListener('resize', requestApply);
        requestApply();
    }

    async setupContainerAbove() {
        await this.populateSemesterDropdown();
        this.initializeCustomSelects();
        this.setupSearchModal();
        this.updateSortControlLabel();
        this.updateAdvancedFilterCountChip();
    }

    async populateSemesterDropdown() {
        const semesters = await fetchAvailableSemesters();
        const semesterSelects = document.querySelectorAll('.semester-select');
        const customSelects = document.querySelectorAll('.custom-select[data-target^="semester-select"]');

        if (semesterSelects.length === 0 || customSelects.length === 0) return;

        const semesterValues = semesters.map((semester) => `${semester.term}-${semester.year}`);
        const prefilterSemesterValue = this.coursePrefilter?.term && this.coursePrefilter?.year
            ? `${this.coursePrefilter.term}-${this.coursePrefilter.year}`
            : null;
        const selectedSemesterValue = prefilterSemesterValue && semesterValues.includes(prefilterSemesterValue)
            ? prefilterSemesterValue
            : (resolvePreferredTermForAvailableSemesters(semesterValues) || semesterValues[0] || null);
        const selectedSemester = semesters.find((semester) => `${semester.term}-${semester.year}` === selectedSemesterValue) || semesters[0] || null;

        semesterSelects.forEach(select => {
            select.innerHTML = '';
            semesters.forEach((semester) => {
                const option = document.createElement('option');
                option.value = `${semester.term}-${semester.year}`;
                option.textContent = semester.label;
                if (option.value === selectedSemesterValue) option.selected = true;
                select.appendChild(option);
            });

            if (selectedSemesterValue) {
                select.value = selectedSemesterValue;
            }
        });

        customSelects.forEach(customSelect => {
            const optionsContainer = customSelect.querySelector('.custom-select-options');
            const valueElement = customSelect.querySelector('.custom-select-value');

            if (!optionsContainer || !valueElement) return;

            optionsContainer.innerHTML = '';
            semesters.forEach((semester) => {
                const value = `${semester.term}-${semester.year}`;
                const customOption = document.createElement('div');
                customOption.className = `ui-select__option custom-select-option${value === selectedSemesterValue ? ' selected' : ''}`;
                customOption.dataset.value = value;
                customOption.textContent = semester.label;
                optionsContainer.appendChild(customOption);
            });

            if (selectedSemester) {
                valueElement.textContent = selectedSemester.label;
            }
        });

        if (selectedSemesterValue) {
            setPreferredTermValue(selectedSemesterValue);
            applyPreferredTermToGlobals(selectedSemesterValue);
        }

        this.setupSemesterSync();
    }

    setupSemesterSync() {
        const semesterSelects = document.querySelectorAll('.semester-select');
        semesterSelects.forEach(select => {
            if (select.dataset.listenerAttached === 'true') return;
            select.dataset.listenerAttached = 'true';
            select.addEventListener('change', async () => {
                const value = select.value;
                const normalizedSelection = normalizeTermValue(value);
                if (normalizedSelection) {
                    setPreferredTermValue(normalizedSelection);
                    applyPreferredTermToGlobals(normalizedSelection);
                }

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
            const professorRaw = (course.professor || '').toLowerCase();
            const professorRomaji = (formatProfessorDisplayName(course.professor || '') || '').toLowerCase();
            const code = (course.course_code || '').toLowerCase();
            return title.includes(normalizedQuery) || professorRaw.includes(normalizedQuery) || professorRomaji.includes(normalizedQuery) || code.includes(normalizedQuery);
        }).slice(0, 6);

        if (suggestions.length === 0) {
            autocompleteContainer.style.display = 'none';
            autocompleteContainer.innerHTML = '';
            return;
        }

        autocompleteContainer.innerHTML = suggestions.map(course => {
            const title = this.escapeHtml(course.title || '');
            const professor = this.escapeHtml(formatProfessorDisplayName(course.professor || ''));
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

        const isSemesterLikeTarget = (targetId) => {
            const normalized = String(targetId || '').trim();
            return normalized === 'semester-select'
                || normalized === 'semester-select-mobile'
                || normalized === 'course-page-semester-select'
                || normalized === 'term-select'
                || normalized === 'year-select';
        };

        const bindContainedScroll = (optionsEl) => {
            if (!optionsEl || optionsEl.dataset.scrollContainBound === 'true') return;
            optionsEl.dataset.scrollContainBound = 'true';

            const canScroll = () => optionsEl.scrollHeight > (optionsEl.clientHeight + 1);
            const atTop = () => optionsEl.scrollTop <= 0;
            const atBottom = () => (optionsEl.scrollTop + optionsEl.clientHeight) >= (optionsEl.scrollHeight - 1);
            let lastTouchY = null;

            optionsEl.addEventListener('wheel', (event) => {
                event.stopPropagation();
                if (!canScroll()) {
                    event.preventDefault();
                    return;
                }
                if ((event.deltaY < 0 && atTop()) || (event.deltaY > 0 && atBottom())) {
                    event.preventDefault();
                }
            }, { passive: false });

            optionsEl.addEventListener('touchstart', (event) => {
                if (!event.touches || !event.touches.length) return;
                lastTouchY = event.touches[0].clientY;
            }, { passive: true });

            optionsEl.addEventListener('touchmove', (event) => {
                event.stopPropagation();
                if (!event.touches || !event.touches.length || lastTouchY === null) return;

                const currentY = event.touches[0].clientY;
                const deltaY = lastTouchY - currentY;
                lastTouchY = currentY;

                if (!canScroll()) {
                    event.preventDefault();
                    return;
                }
                if ((deltaY < 0 && atTop()) || (deltaY > 0 && atBottom())) {
                    event.preventDefault();
                }
            }, { passive: false });

            optionsEl.addEventListener('touchend', () => {
                lastTouchY = null;
            }, { passive: true });

            optionsEl.addEventListener('touchcancel', () => {
                lastTouchY = null;
            }, { passive: true });
        };

        customSelects.forEach(customSelect => {
            const trigger = customSelect.querySelector('.custom-select-trigger');
            const options = customSelect.querySelector('.custom-select-options');
            const targetSelectId = customSelect.dataset.target;
            const targetSelect = document.getElementById(targetSelectId);
            const valueElement = trigger?.querySelector('.custom-select-value');

            if (!trigger || !options || !targetSelect) return;
            if (customSelect.dataset.initialized === 'true') return;
            if (isSemesterLikeTarget(targetSelectId)) {
                bindContainedScroll(options);
            }
            customSelect.dataset.initialized = 'true';

            const syncFromTargetSelect = () => {
                const currentValue = targetSelect.value;
                let matchedOption = null;

                options.querySelectorAll('.custom-select-option').forEach(option => {
                    const isSelected = option.dataset.value === currentValue;
                    option.classList.toggle('selected', isSelected);
                    if (isSelected) matchedOption = option;
                });

                if (!matchedOption) {
                    matchedOption = options.querySelector('.custom-select-option');
                    if (matchedOption) {
                        matchedOption.classList.add('selected');
                        targetSelect.value = matchedOption.dataset.value || '';
                    }
                }

                if (valueElement && matchedOption) {
                    valueElement.textContent = matchedOption.textContent;
                }

                if (targetSelectId === 'assignment-modal-status') {
                    this.updateStatusSelectorAppearance(targetSelect.value, customSelect);
                }
            };

            trigger.addEventListener('click', (event) => {
                event.stopPropagation();
                const shouldOpen = !customSelect.classList.contains('open');
                this.closeModalSelectorPanels({
                    keep: shouldOpen ? 'custom' : null,
                    keepCustomSelect: customSelect
                });

                const shouldForceMobileSheet = targetSelectId === 'assignment-modal-status';
                if (openSemesterMobileSheet({
                    targetSelect,
                    force: shouldForceMobileSheet,
                    title: shouldForceMobileSheet ? 'Status' : undefined,
                    description: shouldForceMobileSheet ? 'Select assignment status' : undefined
                })) {
                    customSelect.classList.remove('open');
                    return;
                }
                customSelect.classList.toggle('open', shouldOpen);
            });

            options.addEventListener('click', (event) => {
                const option = event.target.closest('.custom-select-option');
                if (!option) return;

                const value = option.dataset.value;
                const text = option.textContent;

                options.querySelectorAll('.custom-select-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');

                if (valueElement) valueElement.textContent = text;

                targetSelect.value = value;
                targetSelect.dispatchEvent(new Event('change', { bubbles: true }));

                customSelect.classList.remove('open');
            });

            targetSelect.addEventListener('change', syncFromTargetSelect);
            syncFromTargetSelect();
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
            if (window.innerWidth <= 1023) {
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

            if (window.innerWidth <= 1023) {
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
                this.closeDatePicker();
            }
        });
    }

    switchView(view) {
        const normalizedView = view === 'by-due-date' ? 'by-due-date' : 'all-assignments';
        const previousView = this.currentView;
        this.currentView = normalizedView;
        if (normalizedView !== 'by-due-date') {
            this.closeCalendarDayDetailSheet({ immediate: true, restoreFocus: false });
        }
        if (this.root) {
            this.root.classList.toggle('is-calendar-view', normalizedView === 'by-due-date');
        }

        document.querySelectorAll('.assignments-view-segment[data-view]').forEach(btn => {
            const isCurrent = btn.dataset.view === normalizedView;
            btn.classList.toggle('active', isCurrent);
            btn.classList.toggle('is-active', isCurrent);
            btn.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
        });

        const allView = document.getElementById('all-assignments-view');
        const calendarView = document.getElementById('by-due-date-view');

        if (allView) allView.style.display = normalizedView === 'all-assignments' ? 'block' : 'none';
        if (calendarView) calendarView.style.display = normalizedView === 'by-due-date' ? 'block' : 'none';

        if (normalizedView === 'by-due-date') {
            this.renderCalendarView({ resetSelection: previousView !== 'by-due-date' });
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
        if (!selected) {
            return this.coursePrefilter
                ? this.assignments.filter((assignment) => this.matchesCoursePrefilter(assignment))
                : this.assignments;
        }

        const selectedYear = String(selected.year);
        const selectedTerm = String(selected.term).toLowerCase();

        const semesterAssignments = this.assignments.filter(assignment => {
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

        if (!this.coursePrefilter) {
            return semesterAssignments;
        }

        return semesterAssignments.filter((assignment) => this.matchesCoursePrefilter(assignment));
    }

    renderTableView() {
        const listContainer = document.getElementById('assignments-list');
        const emptyState = document.getElementById('assignments-empty');
        if (!listContainer || !emptyState) return;

        const pipeline = this.getListPipeline();
        this.renderHeaderSummary(pipeline.sorted.length);
        this.renderQuickFilterState();
        this.renderSummaryCards(pipeline.summaryCounts);
        this.closeAllOverflowMenus();

        let emptyType = null;
        if (pipeline.base.length === 0) {
            emptyType = 'none';
        } else if (this.searchQuery && pipeline.searched.length === 0) {
            emptyType = 'search';
        } else if (pipeline.quickFiltered.length === 0) {
            emptyType = this.quickFilter === 'all' ? 'filtered' : 'filter';
        }

        if (emptyType) {
            listContainer.innerHTML = '';
            listContainer.hidden = true;
            emptyState.hidden = false;
            this.renderEmptyState(emptyType, emptyState);
            return;
        }

        listContainer.hidden = false;
        emptyState.hidden = true;
        listContainer.innerHTML = pipeline.sorted.map((assignment) => {
            const normalizedStatus = this.getCanonicalStatus(assignment.status);
            const statusInfo = this.getDisplayStatusInfo(assignment);
            const dueLabel = this.formatDueMetaLabel(this.getDueMeta(assignment));
            const courseTag = assignment.course_tag_name
                ? `<span class="assignment-course-chip" style="background-color:${assignment.course_tag_color || '#e8e0ee'}"><span class="assignment-course-chip-text">${this.escapeHtml(assignment.course_tag_name)}</span></span>`
                : '<span class="assignment-course-chip assignment-course-chip--empty"><span class="assignment-course-chip-text">No course</span></span>';
            const disableProgress = normalizedStatus === 'in_progress' ? 'disabled' : '';
            const disableComplete = normalizedStatus === 'completed' ? 'disabled' : '';

            return `
                <article class="assignment-row-card" data-assignment-id="${assignment.id}" tabindex="0">
                    <div class="assignment-row-left">
                        <span class="assignment-row-icon">${this.escapeHtml(assignment.assignment_icon || '📄')}</span>
                        <div class="assignment-row-copy">
                            <h3 class="assignment-row-title">${this.escapeHtml(assignment.title || 'Untitled Assignment')}</h3>
                            <p class="assignment-row-meta">
                                <span class="assignment-row-due">${this.escapeHtml(dueLabel)}</span>
                                <span class="assignment-row-meta-separator" aria-hidden="true">•</span>
                                ${courseTag}
                            </p>
                        </div>
                    </div>
                    <div class="assignment-row-right">
                        <span class="status-badge ${statusInfo.className}">${statusInfo.label}</span>
                        <div class="assignment-row-overflow">
                            <button class="assignment-overflow-trigger" type="button" aria-label="More actions" aria-expanded="false" data-row-action="toggle-overflow"></button>
                            <div class="assignment-overflow-menu" hidden>
                                <button type="button" class="assignment-overflow-item" data-row-action="open">Open</button>
                                <button type="button" class="assignment-overflow-item" data-row-action="edit">Edit</button>
                                <button type="button" class="assignment-overflow-item" data-row-action="mark-in-progress" ${disableProgress}>Mark in progress</button>
                                <button type="button" class="assignment-overflow-item" data-row-action="mark-completed" ${disableComplete}>Mark completed</button>
                                <button type="button" class="assignment-overflow-item assignment-overflow-item--danger" data-row-action="delete">Delete</button>
                            </div>
                        </div>
                    </div>
                </article>
            `;
        }).join('');
    }

    getCalendarDateKey(value) {
        const date = this.getDateOnly(value);
        return date ? this.formatDateInputValue(date) : '';
    }

    parseCalendarDateKey(key) {
        return this.parseDateFromInputValue(key || '');
    }

    getCalendarChipLimit() {
        return window.matchMedia('(max-width: 1023px)').matches ? 1 : 2;
    }

    getCalendarAssignmentsByDate(assignments) {
        const assignmentsByDate = {};
        assignments.forEach((assignment) => {
            const dueDate = this.getDateOnly(assignment?.due_date);
            if (!dueDate) return;
            const dateKey = this.getCalendarDateKey(dueDate);
            if (!dateKey) return;
            if (!assignmentsByDate[dateKey]) assignmentsByDate[dateKey] = [];
            assignmentsByDate[dateKey].push(assignment);
        });

        Object.values(assignmentsByDate).forEach((dayAssignments) => {
            dayAssignments.sort((a, b) => {
                const dueA = a?.due_date ? new Date(a.due_date) : null;
                const dueB = b?.due_date ? new Date(b.due_date) : null;
                const timeA = Number.isFinite(dueA?.getTime?.()) ? dueA.getTime() : Number.POSITIVE_INFINITY;
                const timeB = Number.isFinite(dueB?.getTime?.()) ? dueB.getTime() : Number.POSITIVE_INFINITY;
                if (timeA !== timeB) return timeA - timeB;
                return String(a?.title || '').localeCompare(String(b?.title || ''));
            });
        });

        return assignmentsByDate;
    }

    getCalendarUrgencyClass(assignment) {
        const status = this.getCanonicalStatus(assignment?.status);
        if (status === 'completed') return 'calendar-assignment--completed';

        const dueDate = this.getDateOnly(assignment?.due_date);
        const today = this.getTodayDate();
        let daysUntilDue = null;

        if (dueDate) {
            const MS_PER_DAY = 24 * 60 * 60 * 1000;
            daysUntilDue = Math.round((dueDate.getTime() - today.getTime()) / MS_PER_DAY);
            if (daysUntilDue < 0) return 'calendar-assignment--overdue';
        }

        if (status === 'in_progress') return 'calendar-assignment--in-progress';
        if (daysUntilDue === 0) return 'calendar-assignment--due-today';
        return 'calendar-assignment--not-started';
    }

    resolveCalendarSelectedDateKey({ year, month, totalDays, assignmentsByDate, resetSelection = false }) {
        const isInVisibleMonth = (date) =>
            !!date &&
            date.getFullYear() === year &&
            date.getMonth() === month &&
            date.getDate() >= 1 &&
            date.getDate() <= totalDays;

        if (!resetSelection && this.selectedCalendarDate) {
            const selectedDate = this.parseCalendarDateKey(this.selectedCalendarDate);
            if (isInVisibleMonth(selectedDate)) {
                return this.getCalendarDateKey(selectedDate);
            }
        }

        const today = this.getTodayDate();
        if (isInVisibleMonth(today)) {
            return this.getCalendarDateKey(today);
        }

        const firstAssignmentDate = Object.keys(assignmentsByDate)
            .map((key) => this.parseCalendarDateKey(key))
            .filter((date) => isInVisibleMonth(date))
            .sort((a, b) => a.getTime() - b.getTime())[0];

        if (firstAssignmentDate) {
            return this.getCalendarDateKey(firstAssignmentDate);
        }

        return this.getCalendarDateKey(new Date(year, month, 1));
    }

    renderCalendarDayDetail(selectedDateKey, assignmentsByDate) {
        const labelNode = document.getElementById('assignments-calendar-day-label');
        const listNode = document.getElementById('assignments-calendar-day-list');
        if (!labelNode || !listNode) return;

        const selectedDate = this.parseCalendarDateKey(selectedDateKey);
        if (!selectedDate) {
            labelNode.textContent = 'Selected date';
            listNode.innerHTML = '';
            return;
        }

        labelNode.textContent = selectedDate.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });

        const dayAssignments = assignmentsByDate[selectedDateKey] || [];

        if (dayAssignments.length === 0) {
            listNode.innerHTML = `
                <div class="assignments-calendar-day-empty">
                    <p class="assignments-calendar-day-empty-copy">No assignments due this day.</p>
                    <button type="button" class="ui-btn ui-btn--primary assignments-calendar-day-new-btn control-surface control-surface--primary" data-day-detail-action="new-assignment">
                        Add Assignment
                    </button>
                </div>
            `;

            const newBtn = listNode.querySelector('[data-day-detail-action="new-assignment"]');
            if (newBtn) {
                newBtn.addEventListener('click', async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    await this.openNewAssignmentModal({ dueDate: selectedDate });
                });
            }
            return;
        }

        listNode.innerHTML = dayAssignments.map((assignment) => {
            const normalizedStatus = this.getCanonicalStatus(assignment.status);
            const statusInfo = this.getDisplayStatusInfo(assignment);
            const chipTextMaxLength = this.getCourseNameDisplayMaxLength();
            const courseMarkup = assignment.course_tag_name
                ? `<span class="assignments-calendar-day-course-chip" style="--day-course-chip-bg:${assignment.course_tag_color || '#e8e0ee'}">${this.escapeHtml(this.truncateText(assignment.course_tag_name, chipTextMaxLength))}</span>`
                : '<span class="assignments-calendar-day-course-chip assignments-calendar-day-course-chip--empty">No course</span>';

            return `
                <button type="button" class="assignments-calendar-day-row" data-assignment-id="${assignment.id}">
                    <div class="assignments-calendar-day-row-main">
                        <h4 class="assignments-calendar-day-row-title">${this.escapeHtml(assignment.title || 'Untitled Assignment')}</h4>
                        <div class="assignments-calendar-day-row-meta">${courseMarkup}</div>
                    </div>
                    <span class="status-badge ${statusInfo.className}">${statusInfo.label}</span>
                </button>
            `;
        }).join('');

        listNode.querySelectorAll('.assignments-calendar-day-row[data-assignment-id]').forEach((row) => {
            row.addEventListener('click', async (event) => {
                event.preventDefault();
                const assignmentId = row.dataset.assignmentId;
                if (!assignmentId) return;
                await this.openAssignmentById(assignmentId);
            });
        });
    }

    renderCalendarView(options = {}) {
        const { resetSelection = false } = options;
        const calendarBody = document.getElementById('calendar-body');
        const monthTitle = document.getElementById('calendar-month-title');
        if (!calendarBody) return;
        this.closeCalendarDayDetailSheet({ immediate: true, restoreFocus: false });

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
        const totalCells = startPadding + totalDays;
        const totalWeeks = Math.ceil(totalCells / 7);
        const todayKey = this.getCalendarDateKey(this.getTodayDate());
        const chipLimit = this.getCalendarChipLimit();
        const useCompactMoreLabel = this.isMobileViewport();

        const pipeline = this.getListPipeline();
        const assignmentsToShow = pipeline.sorted;
        const assignmentsByDate = this.getCalendarAssignmentsByDate(assignmentsToShow);
        const selectedDateKey = this.resolveCalendarSelectedDateKey({
            year,
            month,
            totalDays,
            assignmentsByDate,
            resetSelection
        });
        this.selectedCalendarDate = selectedDateKey;

        let html = '';
        let dayCount = 1;
        for (let week = 0; week < totalWeeks; week++) {
            html += '<div class="calendar-week">';
            for (let day = 0; day < 7; day++) {
                const cellIndex = week * 7 + day;

                if (cellIndex < startPadding || dayCount > totalDays) {
                    html += '<div class="calendar-cell empty" aria-hidden="true"></div>';
                    continue;
                }

                const currentDate = new Date(year, month, dayCount);
                const dateKey = this.getCalendarDateKey(currentDate);
                const isToday = dateKey === todayKey;
                const isSelected = dateKey === selectedDateKey;
                const dayAssignments = assignmentsByDate[dateKey] || [];
                const visibleAssignments = dayAssignments.slice(0, chipLimit);
                const hiddenCount = Math.max(0, dayAssignments.length - visibleAssignments.length);
                const dateLabel = currentDate.toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                });

                html += `
                    <div class="calendar-cell${isToday ? ' today' : ''}${isSelected ? ' calendar-cell--selected' : ''}" tabindex="0" role="button" data-date-key="${dateKey}" aria-label="${this.escapeHtml(dateLabel)}">
                        <div class="day-number">${dayCount}</div>
                        <div class="day-assignments">
                            ${visibleAssignments.map((assignment) => {
                                const urgencyClass = this.getCalendarUrgencyClass(assignment);
                                const courseHint = assignment.course_tag_color || '';
                                const courseStyle = courseHint ? ` style="--calendar-course-hint:${courseHint}"` : '';
                                return `
                                    <button type="button" class="calendar-assignment ${urgencyClass}" data-id="${assignment.id}"${courseStyle}>
                                        <span class="calendar-assignment-label">${this.escapeHtml(assignment.title || 'Untitled Assignment')}</span>
                                    </button>
                                `;
                            }).join('')}
                            ${hiddenCount > 0 ? `<button type="button" class="calendar-more-btn" data-date-key="${dateKey}">+${hiddenCount}${useCompactMoreLabel ? '' : ' more'}</button>` : ''}
                        </div>
                    </div>
                `;
                dayCount++;
            }
            html += '</div>';
        }

        calendarBody.innerHTML = html;
        this.renderHeaderSummary(assignmentsToShow.length);
        if (!this.isMobileViewport()) {
            this.renderCalendarDayDetail(selectedDateKey, assignmentsByDate);
        }

        const selectCalendarDate = (dateKey) => {
            if (!dateKey) return;
            this.selectedCalendarDate = dateKey;
            this.renderCalendarView();
            if (this.isMobileViewport()) {
                this.openCalendarDayDetailSheet(dateKey);
            }
        };

        calendarBody.querySelectorAll('.calendar-cell[data-date-key]').forEach((cell) => {
            cell.addEventListener('click', (event) => {
                if (event.target.closest('.calendar-assignment, .calendar-more-btn')) return;
                const dateKey = cell.dataset.dateKey;
                selectCalendarDate(dateKey);
            });

            cell.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                const dateKey = cell.dataset.dateKey;
                selectCalendarDate(dateKey);
            });
        });

        calendarBody.querySelectorAll('.calendar-more-btn[data-date-key]').forEach((moreButton) => {
            moreButton.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const dateKey = moreButton.dataset.dateKey;
                selectCalendarDate(dateKey);
            });
        });

        calendarBody.querySelectorAll('.calendar-assignment[data-id]').forEach((chip) => {
            chip.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const assignmentId = chip.dataset.id;
                if (!assignmentId) return;
                this.openAssignmentById(assignmentId);
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
        const subjectSelector = document.getElementById('assignment-modal-subject');
        const subjectDropdown = document.getElementById('subject-dropdown');
        const subjectCurrent = document.getElementById('subject-current');
        const deleteBtn = document.getElementById('assignment-delete-btn');
        const emojiTrigger = document.getElementById('assignment-emoji-trigger');
        const saveBtn = document.getElementById('assignment-save-btn');
        const subtitleNode = document.getElementById('assignment-modal-subtitle');

        if (!overlay) return;
        overlay.dataset.assignmentId = assignment?.id != null ? String(assignment.id) : '';
        overlay.dataset.assignmentMode = 'edit';
        if (saveBtn) saveBtn.disabled = false;
        if (saveBtn) saveBtn.textContent = 'Save Changes';

        if (deleteBtn) deleteBtn.style.display = 'block';

        if (titleInput) titleInput.value = assignment.title || '';
        if (dueDateInput && assignment.due_date) {
            dueDateInput.value = assignment.due_date.split('T')[0];
        } else if (dueDateInput) {
            dueDateInput.value = '';
        }
        if (statusSelect) {
            statusSelect.value = this.getCanonicalStatus(assignment.status);
            statusSelect.dispatchEvent(new Event('change', { bubbles: true }));
            this.updateStatusSelectorAppearance(statusSelect.value);
        }
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
                subjectTag.textContent = this.truncateText(assignment.course_tag_name, this.getCourseNameDisplayMaxLength());
                subjectTag.style.backgroundColor = '';
                subjectTag.classList.add('has-tag');
                subjectTag.dataset.code = assignment.course_code || '';
                subjectTag.dataset.color = assignment.course_tag_color || '';
                subjectTag.dataset.year = assignment.course_year || '';
                subjectTag.dataset.term = assignment.course_term || '';
                subjectTag.dataset.fullName = assignment.course_tag_name;
            } else {
                subjectTag.textContent = 'Select course';
                subjectTag.style.backgroundColor = '';
                subjectTag.classList.remove('has-tag');
                subjectTag.dataset.code = '';
                subjectTag.dataset.color = '';
                subjectTag.dataset.year = '';
                subjectTag.dataset.term = '';
                subjectTag.dataset.fullName = '';
            }
        }

        if (subtitleNode) {
            const subtitle = String(assignment?.course_tag_name || '').trim();
            if (subtitle) {
                subtitleNode.textContent = subtitle;
                subtitleNode.hidden = false;
            } else {
                subtitleNode.textContent = '';
                subtitleNode.hidden = true;
            }
        }

        this.updateSubjectSelectorAppearance(subjectTag, subjectSelector);

        if (subjectSelector) subjectSelector.classList.remove('open');
        if (subjectCurrent) subjectCurrent.classList.remove('open');

        this.populateSubjectDropdown(subjectDropdown, subjectTag);

        closeSemesterMobileSheet({ immediate: true });
        this.closeAssignmentDueDateSheet({ immediate: true, restoreFocus: false });
        overlay.style.display = 'flex';
        document.body.classList.add('assignment-modal-open');
    }

    closeAssignmentModal() {
        const overlay = document.getElementById('assignment-modal-overlay');
        const saveBtn = document.getElementById('assignment-save-btn');
        const emojiPicker = document.getElementById('assignment-emoji-picker');
        if (overlay) {
            overlay.style.display = 'none';
            overlay.dataset.assignmentId = '';
            overlay.dataset.assignmentMode = '';
        }
        document.body.classList.remove('assignment-modal-open');
        closeSemesterMobileSheet({ immediate: true });
        this.closeAssignmentDueDateSheet({ immediate: true, restoreFocus: false });
        this.closeDatePicker({ immediate: true });
        if (emojiPicker) {
            emojiPicker.classList.remove('open');
            emojiPicker.style.display = 'none';
            emojiPicker.dataset.hideToken = '';
        }
        if (saveBtn) saveBtn.disabled = false;
        this.currentAssignment = null;
        this.isNewAssignment = false;
        this.isSaving = false;
        const targetView = this.previousView || this.currentView || 'all-assignments';
        this.previousView = null;
        this.switchView(targetView);
        setTimeout(() => this.renderAssignments(), 0);
    }

    loadRecentEmojis() {
        try {
            const raw = window.localStorage.getItem(this.emojiRecentStorageKey);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter(value => typeof value === 'string' && value.trim().length > 0)
                .slice(0, this.emojiRecentLimit);
        } catch (error) {
            return [];
        }
    }

    saveRecentEmojis() {
        try {
            window.localStorage.setItem(
                this.emojiRecentStorageKey,
                JSON.stringify(this.emojiRecentEmojis.slice(0, this.emojiRecentLimit))
            );
        } catch (error) {
            // localStorage may be unavailable in some browser modes
        }
    }

    addRecentEmoji(emoji) {
        if (!emoji || typeof emoji !== 'string') return;
        const deduped = [emoji, ...this.emojiRecentEmojis.filter(value => value !== emoji)];
        this.emojiRecentEmojis = deduped.slice(0, this.emojiRecentLimit);
        this.saveRecentEmojis();
    }

    getEmojiOptionsForCategory(categoryId) {
        if (categoryId === 'recent') {
            return this.emojiRecentEmojis.map(emoji => ({
                emoji,
                keywords: `recent history ${this.emojiKeywordsByValue[emoji] || ''}`.trim()
            }));
        }

        const definition = this.emojiCategoryDefinitions.find(category => category.id === categoryId);
        const baseKeywords = `${definition?.keywords || ''} ${definition?.label?.toLowerCase?.() || ''}`.trim();
        const emojis = this.emojiCatalogByCategory[categoryId] || [];

        return emojis.map(emoji => ({
            emoji,
            keywords: `${baseKeywords} ${this.emojiKeywordsByValue[emoji] || ''}`.trim()
        }));
    }

    renderEmojiPicker(emojiPicker, { preserveSearch = true } = {}) {
        if (!emojiPicker) return;
        const sectionsContainer = emojiPicker.querySelector('#assignment-emoji-sections');
        const categoriesContainer = emojiPicker.querySelector('#assignment-emoji-categories');
        const searchInput = emojiPicker.querySelector('#assignment-emoji-search');
        if (!sectionsContainer || !categoriesContainer) return;

        const searchQuery = preserveSearch ? (searchInput?.value || '') : '';

        sectionsContainer.innerHTML = '';
        categoriesContainer.innerHTML = '';

        const searchSection = document.createElement('div');
        searchSection.className = 'emoji-picker-section';
        searchSection.dataset.group = 'search';

        const searchTitle = document.createElement('div');
        searchTitle.className = 'emoji-picker-section-title';
        searchTitle.textContent = 'Results';
        searchSection.appendChild(searchTitle);

        const searchGrid = document.createElement('div');
        searchGrid.className = 'emoji-picker-grid';
        searchSection.appendChild(searchGrid);

        const searchEmptyState = document.createElement('div');
        searchEmptyState.className = 'emoji-picker-empty';
        searchEmptyState.textContent = 'No emojis found.';
        searchEmptyState.style.display = 'none';
        searchSection.appendChild(searchEmptyState);

        sectionsContainer.appendChild(searchSection);

        this.emojiCategoryDefinitions.forEach(category => {
            const section = document.createElement('div');
            section.className = 'emoji-picker-section';
            section.dataset.group = category.id;

            const title = document.createElement('div');
            title.className = 'emoji-picker-section-title';
            title.textContent = category.label;
            section.appendChild(title);

            const grid = document.createElement('div');
            grid.className = 'emoji-picker-grid';

            const options = this.getEmojiOptionsForCategory(category.id);
            options.forEach(option => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'emoji-option';
                button.dataset.emoji = option.emoji;
                button.dataset.keywords = option.keywords;
                button.textContent = option.emoji;
                grid.appendChild(button);
            });

            section.appendChild(grid);

            const emptyState = document.createElement('div');
            emptyState.className = 'emoji-picker-empty';
            emptyState.textContent = category.id === 'recent'
                ? 'No recent emojis yet.'
                : 'No emojis found.';
            emptyState.style.display = 'none';
            section.appendChild(emptyState);

            sectionsContainer.appendChild(section);

            const categoryButton = document.createElement('button');
            categoryButton.type = 'button';
            categoryButton.className = 'emoji-category-btn';
            categoryButton.dataset.category = category.id;
            categoryButton.title = category.label;
            categoryButton.setAttribute('aria-label', category.label);
            categoryButton.textContent = category.icon;
            categoriesContainer.appendChild(categoryButton);
        });

        if (!preserveSearch && searchInput) {
            searchInput.value = '';
        }

        this.setEmojiPickerCategory(this.emojiActiveCategory, emojiPicker, { preserveSearch: true });
        this.filterEmojiPickerOptions(emojiPicker, searchQuery);
    }

    setEmojiPickerCategory(categoryId, emojiPicker, { preserveSearch = true } = {}) {
        if (!emojiPicker) return;

        const exists = this.emojiCategoryDefinitions.some(category => category.id === categoryId);
        this.emojiActiveCategory = exists ? categoryId : 'people';

        emojiPicker.querySelectorAll('.emoji-category-btn').forEach(button => {
            button.classList.toggle('active', button.dataset.category === this.emojiActiveCategory);
        });

        emojiPicker.querySelectorAll('.emoji-picker-section').forEach(section => {
            section.classList.toggle('active', section.dataset.group === this.emojiActiveCategory);
        });

        const searchInput = emojiPicker.querySelector('#assignment-emoji-search');
        if (!preserveSearch && searchInput) {
            searchInput.value = '';
        }

        this.filterEmojiPickerOptions(emojiPicker, searchInput?.value || '');
    }

    filterEmojiPickerOptions(emojiPicker, query = '') {
        if (!emojiPicker) return;

        const normalizedQuery = query.trim().toLowerCase();
        const searchSection = emojiPicker.querySelector('.emoji-picker-section[data-group="search"]');
        const searchTitle = searchSection?.querySelector('.emoji-picker-section-title');
        const searchGrid = searchSection?.querySelector('.emoji-picker-grid');
        const searchEmptyState = searchSection?.querySelector('.emoji-picker-empty');

        if (!normalizedQuery) {
            emojiPicker.querySelectorAll('.emoji-picker-section').forEach(section => {
                section.classList.toggle('active', section.dataset.group === this.emojiActiveCategory);
            });

            emojiPicker.querySelectorAll('.emoji-category-btn').forEach(button => {
                button.classList.toggle('active', button.dataset.category === this.emojiActiveCategory);
            });

            if (searchGrid) searchGrid.innerHTML = '';
            if (searchEmptyState) searchEmptyState.style.display = 'none';
            if (searchTitle) searchTitle.textContent = 'Results';

            const activeSection = emojiPicker.querySelector(`.emoji-picker-section[data-group="${this.emojiActiveCategory}"]`);
            if (!activeSection) return;

            let visibleCount = 0;
            activeSection.querySelectorAll('.emoji-option').forEach(button => {
                button.style.display = 'inline-flex';
                visibleCount += 1;
            });

            const emptyState = activeSection.querySelector('.emoji-picker-empty');
            if (!emptyState) return;

            if (this.emojiActiveCategory === 'recent' && this.emojiRecentEmojis.length === 0) {
                emptyState.textContent = 'No recent emojis yet.';
                emptyState.style.display = 'block';
                return;
            }

            emptyState.style.display = visibleCount === 0 ? 'block' : 'none';
            return;
        }

        const matches = [];
        const seenEmojis = new Set();
        emojiPicker
            .querySelectorAll('.emoji-picker-section[data-group]:not([data-group="search"]) .emoji-option')
            .forEach(button => {
                const value = (button.dataset.emoji || button.textContent || '').toLowerCase();
                const keywords = (button.dataset.keywords || '').toLowerCase();
                const matchesQuery = value.includes(normalizedQuery) || keywords.includes(normalizedQuery);
                const emojiValue = button.dataset.emoji || button.textContent || '';
                if (!matchesQuery || !emojiValue || seenEmojis.has(emojiValue)) return;
                seenEmojis.add(emojiValue);
                matches.push({
                    emoji: emojiValue,
                    keywords: button.dataset.keywords || ''
                });
            });

        emojiPicker.querySelectorAll('.emoji-picker-section').forEach(section => {
            section.classList.toggle('active', section.dataset.group === 'search');
        });

        if (!searchSection || !searchGrid || !searchEmptyState) return;

        searchGrid.innerHTML = '';
        matches.forEach(match => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'emoji-option';
            button.dataset.emoji = match.emoji;
            button.dataset.keywords = match.keywords;
            button.textContent = match.emoji;
            searchGrid.appendChild(button);
        });

        if (searchTitle) {
            searchTitle.textContent = matches.length > 0 ? `Results (${matches.length})` : 'Results';
        }
        searchEmptyState.style.display = matches.length > 0 ? 'none' : 'block';
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
            if (!this.currentUser) {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session?.user) {
                    throw new Error('User session missing while saving assignment');
                }
                this.currentUser = session.user;
            }

            const titleInput = document.getElementById('assignment-modal-title');
            const dueDateInput = document.getElementById('assignment-modal-due-date');
            const statusSelect = document.getElementById('assignment-modal-status');
            const instructionsTextarea = document.getElementById('assignment-modal-instructions');
            const subjectTag = document.getElementById('subject-tag');
            const emojiTrigger = document.getElementById('assignment-emoji-trigger');
            const saveBtn = document.getElementById('assignment-save-btn');
            const overlay = document.getElementById('assignment-modal-overlay');
            if (saveBtn) saveBtn.disabled = true;

            const courseCode = subjectTag?.dataset.code || null;
            const courseName = subjectTag?.classList.contains('has-tag')
                ? (subjectTag.dataset.fullName || subjectTag.textContent)
                : null;
            const courseColor = subjectTag?.dataset.color || '#e0e0e0';
            const courseYear = subjectTag?.dataset.year || null;
            const courseTerm = subjectTag?.dataset.term || null;

            const parsedDueDate = dueDateInput?.value ? this.parseDateFromInputValue(dueDateInput.value) : null;
            const normalizedDueDate = parsedDueDate ? this.normalizeDateForStorage(parsedDueDate) : null;

            const assignmentIcon = emojiTrigger?.dataset.emoji || '';

            const assignmentData = {
                title: titleInput?.value?.trim() || 'Untitled Assignment',
                due_date: normalizedDueDate ? normalizedDueDate.toISOString() : null,
                status: this.getDatabaseStatus(statusSelect?.value || 'not_started'),
                instructions: instructionsTextarea?.value || '',
                course_code: courseCode || null,
                course_tag_name: courseName || null,
                course_tag_color: courseColor,
                course_year: courseYear || null,
                course_term: courseTerm || null,
                assignment_icon: assignmentIcon ? assignmentIcon : null
            };

            const modalAssignmentId = (overlay?.dataset.assignmentId || '').trim();
            const activeAssignmentId = this.currentAssignment?.id != null
                ? String(this.currentAssignment.id)
                : (modalAssignmentId || null);
            const shouldCreate = this.isNewAssignment && !activeAssignmentId;
            const successMessage = shouldCreate ? 'Assignment created successfully.' : 'Assignment updated successfully.';

            if (shouldCreate) {
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

                this.assignments.push(this.normalizeAssignmentRecord(data));
                this.renderAssignments();
                console.log('Created new assignment:', data);
            } else {
                if (!this.currentAssignment && activeAssignmentId) {
                    this.currentAssignment = this.assignments.find((assignment) => String(assignment?.id) === activeAssignmentId) || null;
                }
                const updatedAssignment = await this.updateAssignment(activeAssignmentId, assignmentData);
                if (!updatedAssignment) {
                    return;
                }
            }

            this.closeAssignmentModal();
            showGlobalToast(successMessage);
        } catch (error) {
            console.error('Error saving assignment:', error);
            showGlobalToast('Failed to save assignment. Please try again.');
            this.isSaving = false;
            const saveBtn = document.getElementById('assignment-save-btn');
            if (saveBtn) saveBtn.disabled = false;
        } finally {
            this.isSaving = false;
            const saveBtn = document.getElementById('assignment-save-btn');
            if (saveBtn) saveBtn.disabled = false;
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

    setDatePickerTriggerState(targetElement, isOpen) {
        if (!targetElement || !targetElement.classList?.contains('date-picker-trigger')) return;
        targetElement.classList.toggle('date-picker-open', isOpen);
        if (!isOpen && typeof targetElement.blur === 'function') {
            targetElement.blur();
        }
    }

    showDatePickerPopup(popup) {
        if (!popup) return;
        popup.style.display = 'block';
        popup.dataset.hideToken = '';

        requestAnimationFrame(() => {
            popup.classList.add('open');
        });
    }

    hideDatePickerPopup(popup, { immediate = false } = {}) {
        if (!popup) return;
        if (!immediate && (popup.style.display === 'none' || popup.style.display === '')) return;

        if (immediate) {
            popup.classList.remove('open');
            popup.style.display = 'none';
            popup.dataset.hideToken = '';
            return;
        }

        const hideToken = `${Date.now()}`;
        popup.dataset.hideToken = hideToken;
        popup.classList.remove('open');

        const finishHide = () => {
            if (popup.dataset.hideToken !== hideToken) return;
            if (!popup.classList.contains('open')) {
                popup.style.display = 'none';
            }
        };

        popup.addEventListener('transitionend', finishHide, { once: true });
        window.setTimeout(finishHide, 240);
    }

    closeDatePicker(options = {}) {
        const { immediate = false } = options;
        const popup = document.getElementById('date-picker-popup');
        if (popup) {
            this.hideDatePickerPopup(popup, { immediate });
        }
        this.setDatePickerTriggerState(this.datePickerTarget?.element, false);
        this.datePickerTarget = null;
    }

    openAssignmentDueDateSheet(targetInput) {
        if (!this.isMobileViewport() || !targetInput) return false;

        this.closeAssignmentDueDateSheet({ immediate: true, restoreFocus: false });

        const normalizeDay = (date) => {
            if (!date) return null;
            return new Date(date.getFullYear(), date.getMonth(), date.getDate());
        };
        const isSameDay = (a, b) => {
            if (!a || !b) return false;
            return a.getFullYear() === b.getFullYear()
                && a.getMonth() === b.getMonth()
                && a.getDate() === b.getDate();
        };
        const todayDate = normalizeDay(new Date());
        const initialValueDate = this.parseDateFromInputValue(targetInput.value || '');
        let selectedDate = normalizeDay(initialValueDate);
        let viewDate = selectedDate
            ? new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
            : new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);

        const layer = document.createElement('div');
        layer.className = 'semester-mobile-sheet-layer assignment-due-date-sheet-layer';
        layer.setAttribute('role', 'presentation');

        const backdrop = document.createElement('div');
        backdrop.className = 'semester-mobile-sheet-backdrop assignment-due-date-sheet-backdrop';

        const sheet = document.createElement('div');
        sheet.className = 'ui-swipe-sheet semester-mobile-sheet assignment-due-date-sheet';
        sheet.dataset.swipeLockSelector = '.assignment-due-date-sheet-options';
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-modal', 'true');
        sheet.setAttribute('aria-label', 'Due Date');

        const indicator = document.createElement('div');
        indicator.className = 'swipe-indicator ui-swipe-sheet__handle';
        indicator.setAttribute('aria-hidden', 'true');

        const header = document.createElement('div');
        header.className = 'semester-mobile-sheet-header assignment-due-date-sheet-header';

        const heading = document.createElement('h2');
        heading.textContent = 'Due Date';
        header.appendChild(heading);

        const subtitle = document.createElement('p');
        subtitle.className = 'semester-mobile-sheet-description assignment-due-date-sheet-description';
        subtitle.textContent = 'Select when this assignment is due';

        const optionsWrap = document.createElement('div');
        optionsWrap.className = 'semester-mobile-sheet-options assignment-due-date-sheet-options';

        const calendarWrap = document.createElement('div');
        calendarWrap.className = 'assignment-due-date-sheet-calendar';

        const calendarHeader = document.createElement('div');
        calendarHeader.className = 'assignment-due-date-sheet-calendar-header';

        const prevButton = document.createElement('button');
        prevButton.type = 'button';
        prevButton.className = 'assignment-due-date-sheet-nav-btn assignment-due-date-sheet-nav-btn--prev';
        prevButton.setAttribute('aria-label', 'Previous month');
        prevButton.textContent = '';

        const monthLabel = document.createElement('h3');
        monthLabel.className = 'assignment-due-date-sheet-month';

        const nextButton = document.createElement('button');
        nextButton.type = 'button';
        nextButton.className = 'assignment-due-date-sheet-nav-btn assignment-due-date-sheet-nav-btn--next';
        nextButton.setAttribute('aria-label', 'Next month');
        nextButton.textContent = '';

        calendarHeader.appendChild(prevButton);
        calendarHeader.appendChild(monthLabel);
        calendarHeader.appendChild(nextButton);

        const calendarGrid = document.createElement('div');
        calendarGrid.className = 'assignment-due-date-sheet-grid';

        const weekdays = document.createElement('div');
        weekdays.className = 'date-picker-weekdays assignment-due-date-sheet-weekdays';
        ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach((weekday) => {
            const dayLabel = document.createElement('span');
            dayLabel.textContent = weekday;
            weekdays.appendChild(dayLabel);
        });

        const daysGrid = document.createElement('div');
        daysGrid.className = 'date-picker-days assignment-due-date-sheet-days';

        calendarGrid.appendChild(weekdays);
        calendarGrid.appendChild(daysGrid);
        calendarWrap.appendChild(calendarHeader);
        calendarWrap.appendChild(calendarGrid);

        const quickWrap = document.createElement('div');
        quickWrap.className = 'assignment-due-date-sheet-quick-actions';

        const todayButton = document.createElement('button');
        todayButton.type = 'button';
        todayButton.className = 'ui-btn ui-btn--secondary control-surface control-surface--secondary assignment-due-date-sheet-quick-btn';
        todayButton.textContent = 'Today';

        const clearButton = document.createElement('button');
        clearButton.type = 'button';
        clearButton.className = 'ui-btn ui-btn--secondary control-surface control-surface--secondary assignment-due-date-sheet-quick-btn';
        clearButton.textContent = 'No Due Date';

        quickWrap.appendChild(todayButton);
        quickWrap.appendChild(clearButton);
        optionsWrap.appendChild(calendarWrap);
        optionsWrap.appendChild(quickWrap);

        const footer = document.createElement('div');
        footer.className = 'semester-mobile-sheet-footer assignment-due-date-sheet-footer';

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'ui-btn ui-btn--secondary semester-mobile-sheet-cancel control-surface control-surface--secondary';
        cancelButton.textContent = 'Cancel';
        footer.appendChild(cancelButton);

        sheet.appendChild(indicator);
        sheet.appendChild(header);
        sheet.appendChild(subtitle);
        sheet.appendChild(optionsWrap);
        sheet.appendChild(footer);
        layer.appendChild(backdrop);
        layer.appendChild(sheet);
        (this.root || document.body).appendChild(layer);

        const onKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            this.closeAssignmentDueDateSheet();
        };

        const onResize = () => {
            if (this.isMobileViewport()) return;
            this.closeAssignmentDueDateSheet({ immediate: true, restoreFocus: false });
        };

        const applySelectedDate = (value) => {
            targetInput.value = value || '';
            this.closeAssignmentDueDateSheet();
        };

        const renderCalendar = () => {
            monthLabel.textContent = viewDate.toLocaleDateString('en-US', {
                month: 'short',
                year: 'numeric'
            });

            const year = viewDate.getFullYear();
            const month = viewDate.getMonth();
            const firstDay = new Date(year, month, 1);
            const lastDay = new Date(year, month + 1, 0);
            const startPadding = firstDay.getDay();
            const totalDays = lastDay.getDate();
            const remainingCells = (7 - ((startPadding + totalDays) % 7)) % 7;
            const fragment = document.createDocumentFragment();

            for (let i = 0; i < startPadding; i++) {
                const prevMonthDay = new Date(year, month, -startPadding + i + 1);
                const mutedButton = document.createElement('button');
                mutedButton.type = 'button';
                mutedButton.className = 'date-picker-day assignment-due-date-sheet-day other-month';
                mutedButton.textContent = String(prevMonthDay.getDate());
                mutedButton.disabled = true;
                mutedButton.setAttribute('aria-hidden', 'true');
                fragment.appendChild(mutedButton);
            }

            for (let day = 1; day <= totalDays; day++) {
                const currentDate = new Date(year, month, day);
                const dayButton = document.createElement('button');
                dayButton.type = 'button';
                dayButton.className = 'date-picker-day assignment-due-date-sheet-day';
                dayButton.dataset.date = this.formatDateInputValue(currentDate);
                dayButton.textContent = String(day);
                if (isSameDay(currentDate, todayDate)) {
                    dayButton.classList.add('today');
                }
                if (selectedDate && isSameDay(currentDate, selectedDate)) {
                    dayButton.classList.add('selected');
                }
                dayButton.setAttribute('aria-label', currentDate.toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                }));
                dayButton.addEventListener('click', (event) => {
                    event.preventDefault();
                    selectedDate = normalizeDay(currentDate);
                    applySelectedDate(this.formatDateInputValue(selectedDate));
                });
                fragment.appendChild(dayButton);
            }

            for (let i = 1; i <= remainingCells; i++) {
                const mutedButton = document.createElement('button');
                mutedButton.type = 'button';
                mutedButton.className = 'date-picker-day assignment-due-date-sheet-day other-month';
                mutedButton.textContent = String(i);
                mutedButton.disabled = true;
                mutedButton.setAttribute('aria-hidden', 'true');
                fragment.appendChild(mutedButton);
            }

            daysGrid.innerHTML = '';
            daysGrid.appendChild(fragment);
        };

        prevButton.addEventListener('click', (event) => {
            event.preventDefault();
            viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
            renderCalendar();
        });

        nextButton.addEventListener('click', (event) => {
            event.preventDefault();
            viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
            renderCalendar();
        });

        todayButton.addEventListener('click', (event) => {
            event.preventDefault();
            selectedDate = normalizeDay(new Date());
            applySelectedDate(this.formatDateInputValue(selectedDate));
        });

        clearButton.addEventListener('click', (event) => {
            event.preventDefault();
            selectedDate = null;
            applySelectedDate('');
        });

        renderCalendar();

        const hadModalOpenClass = document.body.classList.contains('modal-open');
        this.assignmentDueDateSheetState = {
            layer,
            sheet,
            triggerElement: targetInput,
            onKeyDown,
            onResize,
            closeTimer: null,
            hadModalOpenClass
        };

        layer.addEventListener('click', (event) => {
            if (event.target === backdrop || event.target === cancelButton) {
                event.preventDefault();
                this.closeAssignmentDueDateSheet();
            }
        });

        document.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('resize', onResize);
        document.body.classList.add('modal-open');

        if (typeof window.addSwipeToCloseSimple === 'function') {
            window.addSwipeToCloseSimple(sheet, backdrop, () => {
                this.closeAssignmentDueDateSheet({ immediate: true, restoreFocus: false });
            });
        }

        window.requestAnimationFrame(() => {
            layer.classList.add('show');
            sheet.classList.add('show');
        });

        window.setTimeout(() => {
            const focusTarget = daysGrid.querySelector('.assignment-due-date-sheet-day.selected')
                || daysGrid.querySelector('.assignment-due-date-sheet-day.today')
                || prevButton;
            if (focusTarget && typeof focusTarget.focus === 'function') {
                focusTarget.focus({ preventScroll: true });
            }
        }, 20);

        return true;
    }

    closeAssignmentDueDateSheet(options = {}) {
        const { immediate = false, restoreFocus = true } = options;
        const state = this.assignmentDueDateSheetState;
        if (!state) return;

        const {
            layer,
            sheet,
            triggerElement,
            onKeyDown,
            onResize,
            hadModalOpenClass
        } = state;

        if (state.closeTimer) {
            window.clearTimeout(state.closeTimer);
            state.closeTimer = null;
        }

        document.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('resize', onResize);
        if (!hadModalOpenClass) {
            document.body.classList.remove('modal-open');
        }

        if (immediate) {
            layer.remove();
            this.assignmentDueDateSheetState = null;
            if (restoreFocus && triggerElement && typeof triggerElement.focus === 'function') {
                triggerElement.focus({ preventScroll: true });
            }
            return;
        }

        layer.classList.remove('show');
        sheet.classList.remove('show', 'swiping');
        state.closeTimer = window.setTimeout(() => {
            layer.remove();
            if (this.assignmentDueDateSheetState === state) {
                this.assignmentDueDateSheetState = null;
            }
        }, 320);

        if (restoreFocus && triggerElement && typeof triggerElement.focus === 'function') {
            window.setTimeout(() => {
                triggerElement.focus({ preventScroll: true });
            }, 20);
        }
    }

    closeSubjectSelector() {
        const selector = document.getElementById('assignment-modal-subject');
        const current = document.getElementById('subject-current');
        if (selector) selector.classList.remove('open');
        if (current) current.classList.remove('open');
    }

    closeEmojiPicker(options = {}) {
        const { immediate = false } = options;
        const picker = document.getElementById('assignment-emoji-picker');
        if (!picker) return;

        if (immediate) {
            picker.classList.remove('open');
            picker.style.display = 'none';
            picker.dataset.hideToken = '';
            return;
        }

        if (picker.style.display === 'none' || picker.style.display === '') {
            return;
        }

        const hideToken = `${Date.now()}`;
        picker.dataset.hideToken = hideToken;
        picker.classList.remove('open');

        const finishHide = () => {
            if (picker.dataset.hideToken !== hideToken) return;
            if (!picker.classList.contains('open')) {
                picker.style.display = 'none';
            }
        };

        picker.addEventListener('transitionend', finishHide, { once: true });
        window.setTimeout(finishHide, 240);
    }

    closeModalSelectorPanels(options = {}) {
        const { keep = null, keepCustomSelect = null } = options;

        if (keep !== 'date-sheet') {
            this.closeAssignmentDueDateSheet({ immediate: true, restoreFocus: false });
        }

        if (keep !== 'date') {
            this.closeDatePicker();
        }

        if (keep !== 'subject') {
            this.closeSubjectSelector();
        }

        if (keep !== 'mobile-select') {
            closeSemesterMobileSheet({ immediate: true });
        }

        if (keep !== 'emoji') {
            this.closeEmojiPicker();
        }

        document.querySelectorAll('.custom-select.open').forEach((customSelect) => {
            if (keep === 'custom' && keepCustomSelect && customSelect === keepCustomSelect) return;
            customSelect.classList.remove('open');
        });
    }

    openDatePicker(targetElement, assignment, options = {}) {
        const popup = document.getElementById('date-picker-popup');
        if (!popup) return;

        const mode = options.mode || 'table';
        const currentTarget = this.datePickerTarget;
        const popupIsVisible = popup.style.display === 'block' || popup.classList.contains('open');
        const sameTrigger = currentTarget?.element === targetElement &&
            currentTarget?.mode === mode &&
            (mode === 'modal' || currentTarget?.assignment?.id === assignment?.id);

        if (popupIsVisible && sameTrigger) {
            this.hideDatePickerPopup(popup);
            this.setDatePickerTriggerState(targetElement, false);
            this.datePickerTarget = null;
            return;
        }

        if (currentTarget?.element && currentTarget.element !== targetElement) {
            this.setDatePickerTriggerState(currentTarget.element, false);
        }

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
        // Keep the same compact trigger-to-popup distance for table and modal.
        const popupOffset = 8;
        const dropdownOffset = popupOffset;
        popup.style.top = `${rect.bottom + window.scrollY + dropdownOffset}px`;
        popup.style.left = `${rect.left + window.scrollX}px`;

        this.renderDatePicker();
        this.showDatePickerPopup(popup);
        this.setDatePickerTriggerState(targetElement, true);
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
        if (popup) this.hideDatePickerPopup(popup);
        this.setDatePickerTriggerState(this.datePickerTarget?.element, false);

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

    normalizeAssignmentRecord(assignment) {
        if (!assignment || typeof assignment !== 'object') return assignment;
        return {
            ...assignment,
            status: this.getCanonicalStatus(assignment.status)
        };
    }

    getCanonicalStatus(status) {
        const normalized = String(status || '').trim().toLowerCase();
        return this.statusAliases[normalized] || 'not_started';
    }

    getDatabaseStatus(status) {
        const canonical = this.getCanonicalStatus(status);
        if (canonical === 'in_progress') return 'ongoing';
        return canonical;
    }

    getStatusDefinition(status) {
        const canonical = this.getCanonicalStatus(status);
        return this.statusConfig[canonical] || this.statusConfig.not_started;
    }

    getDisplayStatusInfo(assignment) {
        if (this.getDueMeta(assignment).isOverdue) {
            return this.statusConfig.overdue;
        }
        return this.getStatusDefinition(assignment?.status);
    }

    getStatusText(status) {
        return this.getStatusDefinition(status).label;
    }

    getStatusColors(status) {
        return this.getStatusDefinition(status).colors;
    }

    updateStatusSelectorAppearance(status, statusSelector = null) {
        const selector = statusSelector || document.querySelector('.assignment-modal-meta .status-selector[data-target="assignment-modal-status"]');
        if (!selector) return;

        const colors = this.getStatusColors(status);
        selector.style.setProperty('--status-tag-bg', colors.background);
        selector.style.setProperty('--status-tag-color', colors.text);
    }

    getDateOnly(value) {
        if (!value) return null;
        const parsed = new Date(value);
        if (!Number.isFinite(parsed.getTime())) return null;
        return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    }

    getTodayDate() {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    getDueMeta(assignment) {
        const dueDate = this.getDateOnly(assignment?.due_date);
        if (!dueDate) {
            return {
                dueDate: null,
                daysUntilDue: null,
                isDueToday: false,
                isDueSoon: false,
                isOverdue: false
            };
        }

        const today = this.getTodayDate();
        const MS_PER_DAY = 24 * 60 * 60 * 1000;
        const daysUntilDue = Math.round((dueDate.getTime() - today.getTime()) / MS_PER_DAY);
        const status = this.getCanonicalStatus(assignment?.status);
        const isCompleted = status === 'completed';

        return {
            dueDate,
            daysUntilDue,
            isDueToday: daysUntilDue === 0 && !isCompleted,
            isDueSoon: daysUntilDue >= 1 && daysUntilDue <= 7 && !isCompleted,
            isOverdue: daysUntilDue < 0 && !isCompleted
        };
    }

    formatDueMetaLabel(meta) {
        if (!meta?.dueDate) return 'No due date';
        return `Due ${meta.dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }

    setQuickFilter(filter) {
        const allowed = new Set(['all', 'due_today', 'due_soon', 'in_progress', 'completed', 'overdue']);
        const nextFilter = allowed.has(filter) ? filter : 'all';
        this.quickFilter = nextFilter;
        this.renderAssignments();
    }

    syncSearchInputs(value, sourceId = '') {
        ['search-pill-input', 'search-input'].forEach((id) => {
            if (id === sourceId) return;
            const input = document.getElementById(id);
            if (!input) return;
            input.value = value;
        });
    }

    clearSearchQuery() {
        this.searchQuery = '';
        this.syncSearchInputs('', '');
    }

    applySearch(assignments) {
        if (!this.searchQuery) return assignments;
        const q = this.searchQuery.toLowerCase();
        return assignments.filter((assignment) => {
            const title = String(assignment?.title || '').toLowerCase();
            const instructions = String(assignment?.instructions || '').toLowerCase();
            const courseName = String(assignment?.course_tag_name || '').toLowerCase();
            const courseCode = String(assignment?.course_code || '').toLowerCase();
            return title.includes(q) || instructions.includes(q) || courseName.includes(q) || courseCode.includes(q);
        });
    }

    applyAdvancedFilters(assignments) {
        const activeFilters = Object.entries(this.advancedFilters || {}).filter(([, enabled]) => enabled);
        if (!activeFilters.length) return assignments;

        return assignments.filter((assignment) => {
            const hasDueDate = !!this.getDateOnly(assignment?.due_date);
            const hasCourse = !!String(assignment?.course_tag_name || assignment?.course_code || '').trim();

            if (this.advancedFilters.has_due_date && !hasDueDate) return false;
            if (this.advancedFilters.no_due_date && hasDueDate) return false;
            if (this.advancedFilters.with_course && !hasCourse) return false;
            if (this.advancedFilters.without_course && hasCourse) return false;
            return true;
        });
    }

    applyQuickFilter(assignments) {
        const active = this.quickFilter || 'all';
        if (active === 'all') return assignments;

        return assignments.filter((assignment) => {
            const status = this.getCanonicalStatus(assignment.status);
            const dueMeta = this.getDueMeta(assignment);

            if (active === 'due_today') return dueMeta.isDueToday;
            if (active === 'due_soon') return dueMeta.isDueSoon;
            if (active === 'in_progress') return status === 'in_progress';
            if (active === 'completed') return status === 'completed';
            if (active === 'overdue') return dueMeta.isOverdue;
            return true;
        });
    }

    sortAssignments(assignments) {
        const sorted = [...assignments];
        sorted.sort((a, b) => {
            const dueA = this.getDateOnly(a?.due_date);
            const dueB = this.getDateOnly(b?.due_date);
            const titleA = String(a?.title || '');
            const titleB = String(b?.title || '');

            if (this.sortKey === 'title_az') {
                return titleA.localeCompare(titleB);
            }

            if (!dueA && !dueB) {
                return titleA.localeCompare(titleB);
            }
            if (!dueA) return 1;
            if (!dueB) return -1;

            const diff = dueA.getTime() - dueB.getTime();
            if (diff === 0) {
                return titleA.localeCompare(titleB);
            }
            if (this.sortKey === 'due_date_desc') {
                return diff * -1;
            }
            return diff;
        });
        return sorted;
    }

    getListPipeline() {
        const base = this.getAssignmentsForSelectedSemester().map((assignment) => this.normalizeAssignmentRecord(assignment));
        const searched = this.applySearch(base);
        const advancedFiltered = this.applyAdvancedFilters(searched);
        const quickFiltered = this.applyQuickFilter(advancedFiltered);
        const sorted = this.sortAssignments(quickFiltered);

        const summaryCounts = {
            due_soon: advancedFiltered.filter((assignment) => this.getDueMeta(assignment).isDueSoon).length,
            in_progress: advancedFiltered.filter((assignment) => this.getCanonicalStatus(assignment.status) === 'in_progress').length,
            completed: advancedFiltered.filter((assignment) => this.getCanonicalStatus(assignment.status) === 'completed').length,
            overdue: advancedFiltered.filter((assignment) => this.getDueMeta(assignment).isOverdue).length
        };

        return { base, searched, advancedFiltered, quickFiltered, sorted, summaryCounts };
    }

    renderHeaderSummary(visibleCount) {
        const summary = document.getElementById('assignments-results-summary');
        if (!summary) return;
        const countLabel = visibleCount === 1 ? '1 assignment' : `${visibleCount} assignments`;
        summary.textContent = `Showing ${countLabel}`;
    }

    renderQuickFilterState() {
        document.querySelectorAll('.assignment-quick-filter[data-filter]').forEach((chip) => {
            chip.classList.toggle('active', (chip.dataset.filter || 'all') === (this.quickFilter || 'all'));
        });
    }

    renderSummaryCards(summaryCounts) {
        const map = {
            due_soon: summaryCounts.due_soon,
            in_progress: summaryCounts.in_progress,
            completed: summaryCounts.completed,
            overdue: summaryCounts.overdue
        };

        document.querySelectorAll('.assignment-summary-card[data-filter]').forEach((card) => {
            const filter = card.dataset.filter || '';
            const countNode = card.querySelector('.assignment-summary-card-count');
            if (countNode && Object.prototype.hasOwnProperty.call(map, filter)) {
                countNode.textContent = String(map[filter]);
            }
            card.classList.toggle('active', filter === (this.quickFilter || 'all'));
        });
    }

    renderEmptyState(type, emptyNode) {
        if (!emptyNode) return;

        if (type === 'none') {
            emptyNode.innerHTML = `
                <h3>No assignments yet</h3>
                <p>Start building your planner by creating your first assignment.</p>
                <button type="button" class="ui-btn ui-btn--secondary empty-state-cta control-surface control-surface--secondary" data-empty-action="new-assignment">Add Assignment</button>
            `;
            return;
        }

        if (type === 'search') {
            emptyNode.innerHTML = `
                <h3>No search results</h3>
                <p>No assignments match "${this.escapeHtml(this.searchQuery)}".</p>
                <div class="empty-state-actions">
                    <button type="button" class="ui-btn ui-btn--secondary empty-state-cta control-surface control-surface--secondary" data-empty-action="clear-search">Clear Search</button>
                    <button type="button" class="ui-btn ui-btn--secondary empty-state-cta empty-state-cta--secondary control-surface control-surface--secondary" data-empty-action="new-assignment">Add Assignment</button>
                </div>
            `;
            return;
        }

        emptyNode.innerHTML = `
            <h3>No results for this filter</h3>
            <p>Try a different filter or reset to the default list.</p>
            <div class="empty-state-actions">
                <button type="button" class="ui-btn ui-btn--secondary empty-state-cta control-surface control-surface--secondary" data-empty-action="show-all">Show All</button>
                <button type="button" class="ui-btn ui-btn--secondary empty-state-cta empty-state-cta--secondary control-surface control-surface--secondary" data-empty-action="new-assignment">Add Assignment</button>
            </div>
        `;
    }

    openAssignmentsFilterPopover(triggerElement = null) {
        const popover = document.getElementById('assignments-filter-popover');
        const background = document.getElementById('assignments-filter-background');
        const panel = document.getElementById('assignments-filter-panel');
        const filterBtn = document.getElementById('assignments-filter-btn');
        if (!popover || !filterBtn) return;

        if (!popover.classList.contains('hidden')) {
            this.closeAssignmentsFilterPopover();
            return;
        }

        if (this.filterCloseTimer) {
            clearTimeout(this.filterCloseTimer);
            this.filterCloseTimer = null;
        }

        popover.classList.remove('hidden');
        popover.style.transition = '';
        popover.style.opacity = '';
        popover.style.transform = '';
        filterBtn.setAttribute('aria-expanded', 'true');

        const isMobile = window.innerWidth <= 1023;
        if (isMobile) {
            if (background) {
                background.style.transition = 'opacity 220ms ease';
                background.style.opacity = '0';
            }

            if (panel) {
                panel.classList.remove('swiping');
                panel.style.removeProperty('--modal-translate-y');
                panel.style.transition = '';
                panel.style.opacity = '';
                panel.classList.add('show');
            }

            document.body.classList.add('modal-open');

            requestAnimationFrame(() => {
                if (background) background.style.opacity = '1';
            });
        } else {
            popover.style.opacity = '0';
            popover.style.transform = 'translateY(-10px)';
            popover.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

            if (background) {
                background.style.transition = 'opacity 220ms ease';
                background.style.opacity = '0';
            }

            document.body.classList.add('modal-open');

            requestAnimationFrame(() => {
                popover.style.opacity = '1';
                popover.style.transform = 'translateY(0)';
                if (background) background.style.opacity = '1';
            });
        }

        if (!this.assignmentsFilterSwipeBound && typeof window.addSwipeToCloseSimple === 'function' && panel && background) {
            this.assignmentsFilterSwipeBound = true;
            window.addSwipeToCloseSimple(panel, background, () => this.closeAssignmentsFilterPopover(false));
        }

        this.activeAssignmentsFilterTrigger = triggerElement || filterBtn;
        const focusTarget = popover.querySelector('input, button');
        if (focusTarget) setTimeout(() => focusTarget.focus(), 0);
    }

    closeAssignmentsFilterPopover(restoreFocus = true, immediate = false) {
        const popover = document.getElementById('assignments-filter-popover');
        const background = document.getElementById('assignments-filter-background');
        const panel = document.getElementById('assignments-filter-panel');
        const filterBtn = document.getElementById('assignments-filter-btn');
        if (!popover || !filterBtn) return;

        if (this.filterCloseTimer) {
            clearTimeout(this.filterCloseTimer);
            this.filterCloseTimer = null;
        }

        if (popover.classList.contains('hidden') && !immediate) {
            filterBtn.setAttribute('aria-expanded', 'false');
            return;
        }

        const isMobile = window.innerWidth <= 1023;
        if (immediate) {
            if (panel) {
                panel.classList.remove('show', 'swiping');
                panel.style.removeProperty('--modal-translate-y');
                panel.style.transition = '';
                panel.style.opacity = '';
            }
            popover.classList.add('hidden');
            popover.style.transition = '';
            popover.style.opacity = '';
            popover.style.transform = '';
            if (background) {
                background.style.transition = '';
                background.style.opacity = '';
            }
            document.body.classList.remove('modal-open');
        } else if (isMobile) {
            if (panel) {
                panel.classList.remove('show', 'swiping');
                panel.style.removeProperty('--modal-translate-y');
                panel.style.transition = '';
                panel.style.opacity = '';
            }
            if (background) {
                background.style.transition = 'opacity 220ms ease';
                background.style.opacity = '0';
            }
            this.filterCloseTimer = setTimeout(() => {
                popover.classList.add('hidden');
                popover.style.transition = '';
                popover.style.opacity = '';
                popover.style.transform = '';
                if (background) {
                    background.style.transition = '';
                    background.style.opacity = '';
                }
                document.body.classList.remove('modal-open');
                this.filterCloseTimer = null;
            }, 320);
        } else {
            popover.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            popover.style.opacity = '0';
            popover.style.transform = 'translateY(-10px)';

            if (background) {
                background.style.transition = 'opacity 220ms ease';
                background.style.opacity = '0';
            }

            this.filterCloseTimer = setTimeout(() => {
                popover.classList.add('hidden');
                popover.style.transition = '';
                popover.style.opacity = '';
                popover.style.transform = '';
                if (background) {
                    background.style.transition = '';
                    background.style.opacity = '';
                }
                document.body.classList.remove('modal-open');
                this.filterCloseTimer = null;
            }, 300);
        }

        filterBtn.setAttribute('aria-expanded', 'false');
        if (restoreFocus && this.activeAssignmentsFilterTrigger) {
            this.activeAssignmentsFilterTrigger.focus();
        }
        this.activeAssignmentsFilterTrigger = null;
    }

    setupSortControls() {
        if (this.sortControlsBound) return;
        this.sortControlsBound = true;

        const sortBtn = document.getElementById('assignments-sort-btn');
        const sortDropdown = document.getElementById('assignments-sort-dropdown');
        const sortWrapper = sortBtn?.closest('.sort-wrapper');
        if (!sortBtn || !sortDropdown || !sortWrapper) return;

        sortBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const isOpen = sortWrapper.classList.contains('open');
            this.closeAllOverflowMenus();
            this.closeAssignmentsFilterPopover(false);
            sortWrapper.classList.toggle('open', !isOpen);
        });

        sortDropdown.querySelectorAll('.sort-option[data-sort]').forEach((option) => {
            option.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.sortKey = option.dataset.sort || 'due_date_asc';
                sortWrapper.classList.remove('open');
                this.updateSortControlLabel();
                this.renderAssignments();
            });
        });

        document.addEventListener('click', (event) => {
            if (!event.target.closest('#assignments-sort-btn') && !event.target.closest('#assignments-sort-dropdown') && !event.target.closest('.sort-wrapper')) {
                sortWrapper.classList.remove('open');
            }
        });
    }

    updateSortControlLabel() {
        const labelNode = document.getElementById('assignments-sort-label');
        if (!labelNode) return;
        labelNode.textContent = this.sortOptions[this.sortKey] || this.sortOptions.due_date_asc;
        labelNode.dataset.sort = this.sortKey;

        const sortDropdown = document.getElementById('assignments-sort-dropdown');
        if (!sortDropdown) return;
        sortDropdown.querySelectorAll('.sort-option[data-sort]').forEach((option) => {
            option.classList.toggle('selected', option.dataset.sort === this.sortKey);
        });
    }

    setupFilterControls() {
        if (this.filterControlsBound) return;
        this.filterControlsBound = true;

        const filterBtn = document.getElementById('assignments-filter-btn');
        const popover = document.getElementById('assignments-filter-popover');
        const filterPanel = document.getElementById('assignments-filter-panel');
        const filterBackground = document.getElementById('assignments-filter-background');
        if (!filterBtn || !popover || !filterPanel || !filterBackground) return;

        filterBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const isOpen = !popover.classList.contains('hidden');
            this.closeAllOverflowMenus();
            document.querySelectorAll('.sort-wrapper.open').forEach((wrapper) => wrapper.classList.remove('open'));
            if (isOpen) {
                this.closeAssignmentsFilterPopover();
            } else {
                this.openAssignmentsFilterPopover(filterBtn);
            }
        });

        filterPanel.querySelectorAll('input[data-advanced-filter]').forEach((checkbox) => {
            checkbox.addEventListener('change', () => {
                const filterKey = checkbox.dataset.advancedFilter;
                if (!filterKey || !Object.prototype.hasOwnProperty.call(this.advancedFilters, filterKey)) return;
                this.advancedFilters[filterKey] = checkbox.checked;
                this.updateAdvancedFilterCountChip();
                this.renderAssignments();
            });
        });

        const clearBtn = document.getElementById('assignments-clear-advanced-filters');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                Object.keys(this.advancedFilters).forEach((key) => {
                    this.advancedFilters[key] = false;
                });
                filterPanel.querySelectorAll('input[data-advanced-filter]').forEach((checkbox) => {
                    checkbox.checked = false;
                });
                this.updateAdvancedFilterCountChip();
                this.renderAssignments();
            });
        }

        const seeResultsBtn = document.getElementById('assignments-filter-see-results');
        if (seeResultsBtn) {
            seeResultsBtn.addEventListener('click', () => {
                this.closeAssignmentsFilterPopover();
            });
        }

        filterBackground.addEventListener('click', (event) => {
            if (event.target === filterBackground) {
                this.closeAssignmentsFilterPopover();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                this.closeAssignmentsFilterPopover(false);
            }
        });
    }

    updateAdvancedFilterCountChip() {
        const chip = document.getElementById('assignment-filter-count-chip');
        if (!chip) return;
        const activeCount = Object.values(this.advancedFilters).filter(Boolean).length;
        if (activeCount === 0) {
            chip.hidden = true;
            chip.textContent = '';
            return;
        }
        chip.hidden = false;
        chip.textContent = String(activeCount);
    }

    setupAssignmentsListInteractions() {
        if (this.listInteractionsBound) return;
        this.listInteractionsBound = true;

        const listContainer = document.getElementById('assignments-list');
        const emptyState = document.getElementById('assignments-empty');
        if (!listContainer || !emptyState) return;

        const clearRowPressSuppression = () => {
            listContainer
                .querySelectorAll('.assignment-row-card.assignment-row-card--no-press')
                .forEach((rowEl) => rowEl.classList.remove('assignment-row-card--no-press'));
        };

        listContainer.addEventListener('pointerdown', (event) => {
            const overflowRegion = event.target.closest('.assignment-row-overflow');
            if (!overflowRegion) return;
            const row = overflowRegion.closest('.assignment-row-card[data-assignment-id]');
            if (!row) return;
            row.classList.add('assignment-row-card--no-press');
        });

        listContainer.addEventListener('pointerup', clearRowPressSuppression);
        listContainer.addEventListener('pointercancel', clearRowPressSuppression);
        document.addEventListener('pointerup', clearRowPressSuppression, true);

        listContainer.addEventListener('click', async (event) => {
            const row = event.target.closest('.assignment-row-card[data-assignment-id]');
            if (!row) return;
            const id = row.dataset.assignmentId;
            const actionButton = event.target.closest('[data-row-action]');
            if (actionButton) {
                event.preventDefault();
                event.stopPropagation();
                await this.handleRowAction(actionButton.dataset.rowAction, id, row, actionButton);
                row.classList.remove('assignment-row-card--no-press');
                return;
            }
            await this.openAssignmentById(id);
        });

        listContainer.addEventListener('keydown', async (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const row = event.target.closest('.assignment-row-card[data-assignment-id]');
            if (!row) return;
            if (event.target.closest('button')) return;
            event.preventDefault();
            await this.openAssignmentById(row.dataset.assignmentId);
        });

        emptyState.addEventListener('click', async (event) => {
            const actionButton = event.target.closest('[data-empty-action]');
            if (!actionButton) return;
            const action = actionButton.dataset.emptyAction;
            if (action === 'new-assignment') {
                await this.openNewAssignmentModal();
                return;
            }
            if (action === 'clear-search') {
                this.clearSearchQuery();
                this.renderAssignments();
                return;
            }
            if (action === 'show-all') {
                this.setQuickFilter('all');
            }
        });

        document.addEventListener('click', (event) => {
            if (!event.target.closest('.assignment-row-overflow')) {
                this.closeAllOverflowMenus();
            }
        });
    }

    isMobileViewport() {
        return window.innerWidth <= 1023;
    }

    openCalendarDayDetailSheet(selectedDateKey) {
        if (!this.isMobileViewport()) return false;
        const selectedDate = this.parseCalendarDateKey(selectedDateKey);
        if (!selectedDate) return false;

        const pipeline = this.getListPipeline();
        const assignmentsByDate = this.getCalendarAssignmentsByDate(pipeline.sorted);
        const dayAssignments = assignmentsByDate[selectedDateKey] || [];

        this.closeCalendarDayDetailSheet({ immediate: true, restoreFocus: false });

        const layer = document.createElement('div');
        layer.className = 'semester-mobile-sheet-layer assignments-calendar-day-sheet-layer';
        layer.setAttribute('role', 'presentation');

        const backdrop = document.createElement('div');
        backdrop.className = 'semester-mobile-sheet-backdrop assignments-calendar-day-sheet-backdrop';

        const sheet = document.createElement('div');
        sheet.className = 'ui-swipe-sheet semester-mobile-sheet assignments-calendar-day-sheet';
        sheet.dataset.swipeLockSelector = '.assignments-calendar-day-sheet-body';
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-modal', 'true');
        sheet.setAttribute('aria-label', 'Assignments by day');

        const indicator = document.createElement('div');
        indicator.className = 'swipe-indicator ui-swipe-sheet__handle';
        indicator.setAttribute('aria-hidden', 'true');

        const header = document.createElement('div');
        header.className = 'semester-mobile-sheet-header assignments-calendar-day-sheet-header';

        const heading = document.createElement('h2');
        heading.className = 'assignments-calendar-day-sheet-title';
        heading.textContent = selectedDate.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
        header.appendChild(heading);

        const body = document.createElement('div');
        body.className = 'semester-mobile-sheet-options assignments-calendar-day-sheet-body';

        if (dayAssignments.length === 0) {
            body.innerHTML = `
                <div class="assignments-calendar-day-empty">
                    <p class="assignments-calendar-day-empty-copy">No assignments due this day.</p>
                    <button type="button" class="ui-btn ui-btn--primary assignments-calendar-day-new-btn control-surface control-surface--primary" data-day-detail-action="new-assignment">
                        Add Assignment
                    </button>
                </div>
            `;
        } else {
            body.innerHTML = dayAssignments.map((assignment) => {
                const statusInfo = this.getDisplayStatusInfo(assignment);
                const chipTextMaxLength = this.getCourseNameDisplayMaxLength();
                const courseMarkup = assignment.course_tag_name
                    ? `<span class="assignments-calendar-day-course-chip" style="--day-course-chip-bg:${assignment.course_tag_color || '#e8e0ee'}">${this.escapeHtml(this.truncateText(assignment.course_tag_name, chipTextMaxLength))}</span>`
                    : '<span class="assignments-calendar-day-course-chip assignments-calendar-day-course-chip--empty">No course</span>';

                return `
                    <button type="button" class="assignments-calendar-day-row" data-assignment-id="${assignment.id}">
                        <div class="assignments-calendar-day-row-main">
                            <h4 class="assignments-calendar-day-row-title">${this.escapeHtml(assignment.title || 'Untitled Assignment')}</h4>
                            <div class="assignments-calendar-day-row-meta">${courseMarkup}</div>
                        </div>
                        <span class="status-badge ${statusInfo.className}">${statusInfo.label}</span>
                    </button>
                `;
            }).join('');
        }

        const footer = document.createElement('div');
        footer.className = 'semester-mobile-sheet-footer assignments-calendar-day-sheet-footer';

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'ui-btn ui-btn--secondary semester-mobile-sheet-cancel control-surface control-surface--secondary';
        cancelButton.textContent = 'Cancel';
        footer.appendChild(cancelButton);

        sheet.appendChild(indicator);
        sheet.appendChild(header);
        sheet.appendChild(body);
        sheet.appendChild(footer);
        layer.appendChild(backdrop);
        layer.appendChild(sheet);
        (this.root || document.body).appendChild(layer);

        const onKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            this.closeCalendarDayDetailSheet();
        };

        const onResize = () => {
            if (this.isMobileViewport()) return;
            this.closeCalendarDayDetailSheet({ immediate: true, restoreFocus: false });
        };

        const hadModalOpenClass = document.body.classList.contains('modal-open');
        this.calendarDaySheetState = {
            layer,
            sheet,
            onKeyDown,
            onResize,
            closeTimer: null,
            hadModalOpenClass
        };

        body.addEventListener('click', async (event) => {
            const openButton = event.target.closest('.assignments-calendar-day-row[data-assignment-id]');
            if (openButton) {
                event.preventDefault();
                const assignmentId = openButton.dataset.assignmentId;
                if (!assignmentId) return;
                this.closeCalendarDayDetailSheet({ immediate: true, restoreFocus: false });
                await this.openAssignmentById(assignmentId);
                return;
            }

            const newButton = event.target.closest('[data-day-detail-action="new-assignment"]');
            if (newButton) {
                event.preventDefault();
                this.closeCalendarDayDetailSheet({ immediate: true, restoreFocus: false });
                await this.openNewAssignmentModal({ dueDate: selectedDate });
            }
        });

        layer.addEventListener('click', (event) => {
            if (event.target === backdrop || event.target === cancelButton) {
                event.preventDefault();
                this.closeCalendarDayDetailSheet();
            }
        });

        document.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('resize', onResize);
        document.body.classList.add('modal-open');

        if (typeof window.addSwipeToCloseSimple === 'function') {
            window.addSwipeToCloseSimple(sheet, backdrop, () => {
                this.closeCalendarDayDetailSheet({ immediate: true, restoreFocus: false });
            });
        }

        window.requestAnimationFrame(() => {
            layer.classList.add('show');
            sheet.classList.add('show');
        });

        window.setTimeout(() => {
            cancelButton.focus({ preventScroll: true });
        }, 20);

        return true;
    }

    closeCalendarDayDetailSheet({ immediate = false, restoreFocus = false } = {}) {
        const state = this.calendarDaySheetState;
        if (!state) return;

        const {
            layer,
            sheet,
            onKeyDown,
            onResize,
            hadModalOpenClass
        } = state;

        if (state.closeTimer) {
            window.clearTimeout(state.closeTimer);
            state.closeTimer = null;
        }

        document.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('resize', onResize);

        if (!hadModalOpenClass) {
            document.body.classList.remove('modal-open');
        }

        if (immediate) {
            layer.remove();
            this.calendarDaySheetState = null;
            return;
        }

        layer.classList.remove('show');
        sheet.classList.remove('show', 'swiping');
        state.closeTimer = window.setTimeout(() => {
            layer.remove();
            if (this.calendarDaySheetState === state) {
                this.calendarDaySheetState = null;
            }
        }, 320);
    }

    openAssignmentActionsSheet(assignmentId, triggerElement = null) {
        if (!this.isMobileViewport()) return false;
        const assignment = this.assignments.find((item) => String(item?.id) === String(assignmentId));
        if (!assignment) return false;

        this.closeAssignmentActionsSheet({ immediate: true, restoreFocus: false });

        const normalizedStatus = this.getCanonicalStatus(assignment.status);
        const layer = document.createElement('div');
        layer.className = 'semester-mobile-sheet-layer assignment-actions-sheet-layer';
        layer.setAttribute('role', 'presentation');

        const backdrop = document.createElement('div');
        backdrop.className = 'semester-mobile-sheet-backdrop assignment-actions-sheet-backdrop';

        const sheet = document.createElement('div');
        sheet.className = 'ui-swipe-sheet semester-mobile-sheet assignment-actions-sheet';
        sheet.dataset.swipeLockSelector = '.assignment-actions-sheet-options';
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-modal', 'true');
        sheet.setAttribute('aria-label', 'Assignment actions');

        const indicator = document.createElement('div');
        indicator.className = 'swipe-indicator ui-swipe-sheet__handle';
        indicator.setAttribute('aria-hidden', 'true');

        const actionsWrap = document.createElement('div');
        actionsWrap.className = 'semester-mobile-sheet-options assignment-actions-sheet-options';

        const actionItems = [
            { action: 'open', label: 'Open', disabled: false, danger: false },
            { action: 'edit', label: 'Edit', disabled: false, danger: false },
            { action: 'mark-in-progress', label: 'Mark in progress', disabled: normalizedStatus === 'in_progress', danger: false },
            { action: 'mark-completed', label: 'Mark completed', disabled: normalizedStatus === 'completed', danger: false },
            { action: 'delete', label: 'Delete', disabled: false, danger: true }
        ];

        actionItems.forEach((item) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `semester-mobile-sheet-option assignment-actions-sheet-item${item.danger ? ' assignment-actions-sheet-item--danger' : ''}`;
            button.dataset.rowAction = item.action;
            if (item.disabled) {
                button.disabled = true;
                button.setAttribute('aria-disabled', 'true');
            }

            const icon = document.createElement('span');
            icon.className = 'assignment-actions-sheet-item-icon';
            icon.setAttribute('aria-hidden', 'true');

            const label = document.createElement('span');
            label.className = 'assignment-actions-sheet-item-label';
            label.textContent = item.label;

            button.appendChild(icon);
            button.appendChild(label);
            actionsWrap.appendChild(button);
        });

        const footer = document.createElement('div');
        footer.className = 'semester-mobile-sheet-footer assignment-actions-sheet-footer';

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'ui-btn ui-btn--secondary semester-mobile-sheet-cancel control-surface control-surface--secondary';
        cancelButton.textContent = 'Cancel';

        footer.appendChild(cancelButton);

        sheet.appendChild(indicator);
        sheet.appendChild(actionsWrap);
        sheet.appendChild(footer);
        layer.appendChild(backdrop);
        layer.appendChild(sheet);
        document.body.appendChild(layer);

        const onKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            this.closeAssignmentActionsSheet();
        };

        const onResize = () => {
            if (this.isMobileViewport()) return;
            this.closeAssignmentActionsSheet({ immediate: true, restoreFocus: false });
        };

        const hadModalOpenClass = document.body.classList.contains('modal-open');
        this.assignmentActionsSheetState = {
            assignmentId: String(assignmentId),
            layer,
            sheet,
            triggerElement,
            onKeyDown,
            onResize,
            closeTimer: null,
            hadModalOpenClass
        };

        layer.addEventListener('click', async (event) => {
            event.stopPropagation();

            const actionButton = event.target.closest('.assignment-actions-sheet-item[data-row-action]');
            if (actionButton) {
                event.preventDefault();
                if (actionButton.disabled) return;
                const action = actionButton.dataset.rowAction;
                this.closeAssignmentActionsSheet({ immediate: true, restoreFocus: false });
                await this.handleRowAction(action, assignmentId, null, actionButton);
                return;
            }

            if (event.target === backdrop || event.target === cancelButton) {
                event.preventDefault();
                this.closeAssignmentActionsSheet();
            }
        });

        document.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('resize', onResize);
        document.body.classList.add('modal-open');

        if (typeof window.addSwipeToCloseSimple === 'function') {
            window.addSwipeToCloseSimple(sheet, backdrop, () => {
                this.closeAssignmentActionsSheet({ immediate: true, restoreFocus: false });
            });
        }

        window.requestAnimationFrame(() => {
            layer.classList.add('show');
            sheet.classList.add('show');
        });

        window.setTimeout(() => {
            cancelButton.focus({ preventScroll: true });
        }, 20);

        return true;
    }

    closeAssignmentActionsSheet({ immediate = false, restoreFocus = true } = {}) {
        const state = this.assignmentActionsSheetState;
        if (!state) return;

        const {
            layer,
            sheet,
            triggerElement,
            onKeyDown,
            onResize,
            hadModalOpenClass
        } = state;

        if (state.closeTimer) {
            window.clearTimeout(state.closeTimer);
            state.closeTimer = null;
        }

        document.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('resize', onResize);

        if (!hadModalOpenClass) {
            document.body.classList.remove('modal-open');
        }

        if (immediate) {
            layer.remove();
            this.assignmentActionsSheetState = null;
            if (restoreFocus && triggerElement && typeof triggerElement.focus === 'function') {
                triggerElement.focus({ preventScroll: true });
            }
            return;
        }

        layer.classList.remove('show');
        sheet.classList.remove('show', 'swiping');
        state.closeTimer = window.setTimeout(() => {
            layer.remove();
            if (this.assignmentActionsSheetState === state) {
                this.assignmentActionsSheetState = null;
            }
        }, 320);

        if (restoreFocus && triggerElement && typeof triggerElement.focus === 'function') {
            window.setTimeout(() => {
                triggerElement.focus({ preventScroll: true });
            }, 20);
        }
    }

    async openAssignmentById(assignmentId, options = {}) {
        const assignment = this.assignments.find((item) => String(item?.id) === String(assignmentId));
        if (!assignment) return;
        this.openAssignmentModal(assignment);
        if (options.focusTitle) {
            window.setTimeout(() => {
                const input = document.getElementById('assignment-modal-title');
                if (input) input.focus();
            }, 30);
        }
    }

    closeAllOverflowMenus(exceptRow = null) {
        this.closeAssignmentActionsSheet({ immediate: true, restoreFocus: false });

        document.querySelectorAll('.assignment-row-card .assignment-overflow-menu').forEach((menu) => {
            const row = menu.closest('.assignment-row-card');
            const isTargetRow = exceptRow && row === exceptRow;
            if (isTargetRow) return;
            menu.hidden = true;
            if (row) row.classList.remove('assignment-row-card--overflow-open');
        });
        document.querySelectorAll('.assignment-overflow-trigger[aria-expanded="true"]').forEach((trigger) => {
            const row = trigger.closest('.assignment-row-card');
            const isTargetRow = exceptRow && row === exceptRow;
            if (isTargetRow) return;
            trigger.setAttribute('aria-expanded', 'false');
        });
    }

    async handleRowAction(action, assignmentId, row, actionButton) {
        if (!action || !assignmentId) return;
        if (action === 'toggle-overflow') {
            if (this.isMobileViewport()) {
                const isSameSheetOpen = this.assignmentActionsSheetState
                    && this.assignmentActionsSheetState.assignmentId === String(assignmentId);
                if (isSameSheetOpen) {
                    this.closeAssignmentActionsSheet();
                    return;
                }

                this.closeAllOverflowMenus();
                this.openAssignmentActionsSheet(assignmentId, actionButton || null);
                return;
            }

            const menu = row.querySelector('.assignment-overflow-menu');
            const trigger = row.querySelector('.assignment-overflow-trigger');
            if (!menu || !trigger) return;
            const shouldOpen = menu.hidden;
            this.closeAllOverflowMenus(shouldOpen ? row : null);
            menu.hidden = !shouldOpen;
            trigger.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
            row.classList.toggle('assignment-row-card--overflow-open', shouldOpen);
            return;
        }

        this.closeAllOverflowMenus();

        if (action === 'open') {
            await this.openAssignmentById(assignmentId);
            return;
        }
        if (action === 'edit') {
            await this.openAssignmentById(assignmentId, { focusTitle: true });
            return;
        }
        if (action === 'mark-in-progress') {
            if (actionButton?.disabled) return;
            await this.updateAssignment(assignmentId, { status: 'in_progress' });
            return;
        }
        if (action === 'mark-completed') {
            if (actionButton?.disabled) return;
            await this.updateAssignment(assignmentId, { status: 'completed' });
            return;
        }
        if (action === 'delete') {
            await this.deleteAssignment(assignmentId);
        }
    }

    applySubjectSelection(selection = {}, refs = {}) {
        const code = String(selection.code || '');
        const name = String(selection.name || '');
        const color = String(selection.color || '');
        const year = String(selection.year || '');
        const term = String(selection.term || '');

        const subjectTag = refs.subjectTag || document.getElementById('subject-tag');
        const subjectSelector = refs.subjectSelector || document.getElementById('assignment-modal-subject');
        const subjectCurrent = refs.subjectCurrent || document.getElementById('subject-current');
        const subjectDropdown = refs.subjectDropdown || document.getElementById('subject-dropdown');
        const subjectSelect = refs.subjectSelect || document.getElementById('assignment-modal-course-select');

        if (subjectTag) {
            if (code && name) {
                subjectTag.textContent = this.truncateText(name, this.getCourseNameDisplayMaxLength());
                subjectTag.style.backgroundColor = '';
                subjectTag.classList.add('has-tag');
                subjectTag.dataset.code = code;
                subjectTag.dataset.color = color;
                subjectTag.dataset.year = year;
                subjectTag.dataset.term = term;
                subjectTag.dataset.fullName = name;
            } else {
                subjectTag.textContent = 'Select course';
                subjectTag.style.backgroundColor = '';
                subjectTag.classList.remove('has-tag');
                subjectTag.dataset.code = '';
                subjectTag.dataset.color = '';
                subjectTag.dataset.year = '';
                subjectTag.dataset.term = '';
                subjectTag.dataset.fullName = '';
            }
        }

        if (subjectSelect) {
            subjectSelect.value = code;
            if (subjectSelect.value !== code) {
                subjectSelect.value = '';
            }
        }

        if (subjectDropdown) {
            subjectDropdown.querySelectorAll('.subject-option').forEach((option) => {
                const optionCode = String(option.dataset.code || '');
                option.classList.toggle('selected', optionCode === code);
            });
        }

        if (subjectSelector) subjectSelector.classList.remove('open');
        if (subjectCurrent) subjectCurrent.classList.remove('open');
        this.updateSubjectSelectorAppearance(subjectTag, subjectSelector);
    }

    updateSubjectSelectorAppearance(subjectTag = null, subjectSelector = null) {
        const tag = subjectTag || document.getElementById('subject-tag');
        const selector = subjectSelector || document.getElementById('assignment-modal-subject');
        if (!tag || !selector) return;

        const hasTag = tag.classList.contains('has-tag');
        const tagBg = hasTag ? (tag.dataset.color || '#e0e0e0') : 'transparent';

        selector.style.setProperty('--subject-selector-bg', 'white');
        selector.style.setProperty('--subject-tag-bg', tagBg);
        selector.style.setProperty('--subject-tag-color', hasTag ? '#333' : '#666');
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

    getCourseNameDisplayMaxLength() {
        if (!this.isMobileViewport()) {
            return this.courseNameDisplayMaxLengthDesktop;
        }

        const viewportWidth = Math.max(window.innerWidth || 0, 320);
        const responsiveLength = Math.floor(viewportWidth / 16);
        return Math.max(18, Math.min(this.courseNameDisplayMaxLengthMobile, responsiveLength));
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
