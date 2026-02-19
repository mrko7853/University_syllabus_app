import { supabase } from "../supabase.js";
import { fetchAvailableSemesters, fetchCourseData, getCourseColorByType } from "./shared.js";
import { applyPreferredTermToGlobals, getPreferredTermValue, normalizeTermValue, setPreferredTermValue } from "./preferences.js";

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
        this.courseNameDisplayMaxLength = 22;
        this.emojiRecentStorageKey = 'assignments_recent_emojis_v1';
        this.emojiRecentLimit = 24;
        this.emojiActiveCategory = 'people';
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

    async init() {
        if (this.isInitialized || this.isInitializing) return;
        this.isInitializing = true;

        try {
            console.log('Assignments Manager: Starting initialization...');
            const shouldOpenNewAssignment = this.consumeOpenNewAssignmentIntent();

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
            if (!handledHashRoute && shouldOpenNewAssignment) {
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
        const subjectSelector = document.getElementById('assignment-modal-subject');
        const subjectDropdown = document.getElementById('subject-dropdown');
        const subjectCurrent = document.getElementById('subject-current');
        const deleteBtn = document.getElementById('assignment-delete-btn');
        const emojiTrigger = document.getElementById('assignment-emoji-trigger');
        const saveBtn = document.getElementById('assignment-save-btn');

        if (!overlay) return;
        if (saveBtn) saveBtn.disabled = false;

        if (titleInput) titleInput.value = '';
        if (dueDateInput) dueDateInput.value = this.formatDateInputValue(new Date());
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

        overlay.style.display = 'flex';
    }

    populateSubjectDropdown(subjectDropdown, subjectTag) {
        if (!subjectDropdown) return;

        const coursesForSemester = this.getCoursesForSelectedSemester();
        const selectedCode = subjectTag?.dataset.code || '';
        console.log('Populating dropdown with courses:', coursesForSemester);

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
                const name = option.dataset.name;
                const color = option.dataset.color;
                const current = document.getElementById('subject-current');
                const selector = document.getElementById('assignment-modal-subject');

                if (subjectTag) {
                    if (name) {
                        subjectTag.textContent = this.truncateText(name, this.courseNameDisplayMaxLength);
                        subjectTag.style.backgroundColor = '';
                        subjectTag.classList.add('has-tag');
                        subjectTag.dataset.code = option.dataset.code;
                        subjectTag.dataset.color = color;
                        subjectTag.dataset.year = option.dataset.year || '';
                        subjectTag.dataset.term = option.dataset.term || '';
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

                this.updateSubjectSelectorAppearance(subjectTag, selector);

                subjectDropdown.querySelectorAll('.subject-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
                if (selector) selector.classList.remove('open');
                if (current) current.classList.remove('open');
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

        document.querySelectorAll('.tab-btn[data-view]').forEach(btn => {
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
            deleteBtn.addEventListener('click', () => {
                if (this.currentAssignment) {
                    this.deleteAssignment(this.currentAssignment.id);
                }
            });
        }

        const subjectCurrent = document.getElementById('subject-current');
        const subjectDropdown = document.getElementById('subject-dropdown');
        const subjectSelector = document.getElementById('assignment-modal-subject');
        if (subjectCurrent && subjectDropdown && subjectSelector) {
            // Clone the element to remove any existing event listeners
            const newSubjectCurrent = subjectCurrent.cloneNode(true);
            subjectCurrent.parentNode.replaceChild(newSubjectCurrent, subjectCurrent);

            newSubjectCurrent.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                document.querySelectorAll('.custom-select').forEach(customSelect => {
                    customSelect.classList.remove('open');
                });
                const dropdown = document.getElementById('subject-dropdown');
                const selector = document.getElementById('assignment-modal-subject');
                if (!dropdown) return;
                if (!selector) return;
                const shouldOpen = !selector.classList.contains('open');
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

        const semesterValues = semesters.map((semester) => `${semester.term}-${semester.year}`);
        const preferredTerm = getPreferredTermValue();
        const selectedSemesterValue = preferredTerm && semesterValues.includes(preferredTerm)
            ? preferredTerm
            : (semesterValues[0] || null);
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
                customOption.className = `custom-select-option${value === selectedSemesterValue ? ' selected' : ''}`;
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
            const valueElement = trigger?.querySelector('.custom-select-value');

            if (!trigger || !options || !targetSelect) return;
            if (customSelect.dataset.initialized === 'true') return;
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
                this.hideDatePickerPopup(popup);
                this.setDatePickerTriggerState(this.datePickerTarget?.element, false);
                this.datePickerTarget = null;
            }
        });
    }

    switchView(view) {
        const normalizedView = view === 'by-due-date' ? 'by-due-date' : 'all-assignments';
        this.currentView = normalizedView;

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === normalizedView);
        });

        const allView = document.getElementById('all-assignments-view');
        const calendarView = document.getElementById('by-due-date-view');

        if (allView) allView.style.display = normalizedView === 'all-assignments' ? 'block' : 'none';
        if (calendarView) calendarView.style.display = normalizedView === 'by-due-date' ? 'block' : 'none';

        if (normalizedView === 'by-due-date') {
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

            const displayCourseTagName = this.truncateText(assignment.course_tag_name, this.courseNameDisplayMaxLength);
            const tagHtml = assignment.course_tag_name
                ? `<span class="course-tag" style="background-color: ${assignment.course_tag_color}">${this.escapeHtml(displayCourseTagName)}</span>`
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
        const subjectSelector = document.getElementById('assignment-modal-subject');
        const subjectDropdown = document.getElementById('subject-dropdown');
        const subjectCurrent = document.getElementById('subject-current');
        const deleteBtn = document.getElementById('assignment-delete-btn');
        const emojiTrigger = document.getElementById('assignment-emoji-trigger');
        const saveBtn = document.getElementById('assignment-save-btn');

        if (!overlay) return;
        if (saveBtn) saveBtn.disabled = false;

        if (deleteBtn) deleteBtn.style.display = 'block';

        if (titleInput) titleInput.value = assignment.title || '';
        if (dueDateInput && assignment.due_date) {
            dueDateInput.value = assignment.due_date.split('T')[0];
        } else if (dueDateInput) {
            dueDateInput.value = '';
        }
        if (statusSelect) {
            statusSelect.value = assignment.status || 'not_started';
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
                subjectTag.textContent = this.truncateText(assignment.course_tag_name, this.courseNameDisplayMaxLength);
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

        this.updateSubjectSelectorAppearance(subjectTag, subjectSelector);

        if (subjectSelector) subjectSelector.classList.remove('open');
        if (subjectCurrent) subjectCurrent.classList.remove('open');

        this.populateSubjectDropdown(subjectDropdown, subjectTag);

        overlay.style.display = 'flex';
    }

    closeAssignmentModal() {
        const overlay = document.getElementById('assignment-modal-overlay');
        const saveBtn = document.getElementById('assignment-save-btn');
        const datePickerPopup = document.getElementById('date-picker-popup');
        const emojiPicker = document.getElementById('assignment-emoji-picker');
        if (overlay) {
            overlay.style.display = 'none';
        }
        if (datePickerPopup) {
            this.hideDatePickerPopup(datePickerPopup, { immediate: true });
        }
        this.setDatePickerTriggerState(this.datePickerTarget?.element, false);
        this.datePickerTarget = null;
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
            const titleInput = document.getElementById('assignment-modal-title');
            const dueDateInput = document.getElementById('assignment-modal-due-date');
            const statusSelect = document.getElementById('assignment-modal-status');
            const instructionsTextarea = document.getElementById('assignment-modal-instructions');
            const subjectTag = document.getElementById('subject-tag');
            const emojiTrigger = document.getElementById('assignment-emoji-trigger');
            const saveBtn = document.getElementById('assignment-save-btn');
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

    getStatusText(status) {
        const statusMap = {
            'not_started': 'Not Started',
            'ongoing': 'Ongoing',
            'completed': 'Completed'
        };
        return statusMap[status] || status;
    }

    getStatusColors(status) {
        const statusColors = {
            'not_started': { background: '#e9ecef', text: '#6c757d' },
            'ongoing': { background: '#fff3cd', text: '#856404' },
            'completed': { background: '#d4edda', text: '#155724' }
        };
        return statusColors[status] || { background: 'white', text: 'black' };
    }

    updateStatusSelectorAppearance(status, statusSelector = null) {
        const selector = statusSelector || document.querySelector('.assignment-modal-meta .status-selector[data-target="assignment-modal-status"]');
        if (!selector) return;

        const colors = this.getStatusColors(status);
        selector.style.setProperty('--status-tag-bg', colors.background);
        selector.style.setProperty('--status-tag-color', colors.text);
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
