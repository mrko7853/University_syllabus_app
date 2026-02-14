import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AssignmentsScreen } from '@/src/screens/AssignmentsScreen';

jest.mock('@/src/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
  }),
}));

jest.mock('@/src/context/SemesterContext', () => ({
  useSemester: () => ({
    semesters: [{ term: 'Fall', year: 2025, label: 'Fall 2025' }],
    selectedSemester: { term: 'Fall', year: 2025, label: 'Fall 2025' },
    setSelectedSemester: jest.fn(),
  }),
}));

const mockFetchAssignments = jest.fn();
const mockCreateAssignment = jest.fn();
const mockUpdateAssignment = jest.fn();
const mockDeleteAssignment = jest.fn();

jest.mock('@/src/services/assignments', () => ({
  fetchAssignments: (...args: unknown[]) => mockFetchAssignments(...args),
  createAssignment: (...args: unknown[]) => mockCreateAssignment(...args),
  updateAssignment: (...args: unknown[]) => mockUpdateAssignment(...args),
  deleteAssignment: (...args: unknown[]) => mockDeleteAssignment(...args),
}));

jest.mock('@/src/services/courses', () => ({
  fetchCourseData: jest.fn(async () => []),
  fetchUserSelectedCourseCodes: jest.fn(async () => []),
}));

describe('AssignmentsScreen', () => {
  beforeEach(() => {
    mockFetchAssignments.mockResolvedValue([]);
    mockCreateAssignment.mockResolvedValue({
      id: 'new-id',
      user_id: 'user-1',
      title: 'New Task',
      due_date: null,
      status: 'not_started',
      instructions: '',
      course_code: null,
      course_tag_name: null,
      course_tag_color: '#e0e0e0',
      course_year: null,
      course_term: null,
      assignment_icon: '📄',
    });
    mockUpdateAssignment.mockResolvedValue({});
    mockDeleteAssignment.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('creates an assignment from the modal form', async () => {
    render(<AssignmentsScreen />);

    await waitFor(() => {
      expect(mockFetchAssignments).toHaveBeenCalledWith('user-1');
    });

    fireEvent.press(screen.getByText('New'));
    fireEvent.changeText(screen.getByPlaceholderText('Title'), 'Write essay');
    fireEvent.press(screen.getByText('Save Assignment'));

    await waitFor(() => {
      expect(mockCreateAssignment).toHaveBeenCalled();
    });

    expect(mockCreateAssignment.mock.calls[0][0]).toBe('user-1');
    expect(mockCreateAssignment.mock.calls[0][1].title).toBe('Write essay');
  });
});
