import { render, screen, waitFor } from '@testing-library/react-native';
import { CoursesScreen } from '@/src/screens/CoursesScreen';

jest.mock('@/src/context/AuthContext', () => ({
  useAuth: () => ({
    session: { user: { id: 'user-1' } },
  }),
}));

const mockSemesterState = {
  semesters: [{ term: 'Fall', year: 2025, label: 'Fall 2025' }],
  selectedSemester: { term: 'Fall', year: 2025, label: 'Fall 2025' },
  loading: false,
  setSelectedSemester: jest.fn(),
  refreshSemesters: jest.fn(),
};

jest.mock('@/src/context/SemesterContext', () => ({
  useSemester: () => mockSemesterState,
}));

const mockFetchCourseData = jest.fn();

jest.mock('@/src/services/courses', () => ({
  fetchCourseData: (...args: unknown[]) => mockFetchCourseData(...args),
}));

describe('CoursesScreen', () => {
  beforeEach(() => {
    mockFetchCourseData.mockResolvedValue([
      {
        course_code: '12001104-003',
        title: 'Academic Writing',
        professor: 'Greco',
        term: 'Fall',
        academic_year: 2025,
        time_slot: 'Thu 14:55 - 16:25',
        gpa_a_percent: 50,
        gpa_b_percent: 30,
        gpa_c_percent: 10,
      },
    ]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders fetched courses in list', async () => {
    render(<CoursesScreen />);

    await waitFor(() => {
      expect(screen.getByText('Academic Writing')).toBeTruthy();
    });

    expect(screen.getByText('12001104-003')).toBeTruthy();
    expect(mockFetchCourseData).toHaveBeenCalledWith(2025, 'Fall');
  });
});
