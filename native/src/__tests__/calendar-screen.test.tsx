import { render, screen, waitFor } from '@testing-library/react-native';
import { CalendarScreen } from '@/src/screens/CalendarScreen';

jest.mock('@/src/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
  }),
}));

jest.mock('@/src/context/SemesterContext', () => ({
  useSemester: () => ({
    semesters: [{ term: 'Fall', year: 2025, label: 'Fall 2025' }],
    selectedSemester: { term: 'Fall', year: 2025, label: 'Fall 2025' },
    loading: false,
    setSelectedSemester: jest.fn(),
  }),
}));

const mockFetchCourseData = jest.fn();
const mockFetchUserSelectedCourseCodes = jest.fn();

jest.mock('@/src/services/courses', () => ({
  fetchCourseData: (...args: unknown[]) => mockFetchCourseData(...args),
  fetchUserSelectedCourseCodes: (...args: unknown[]) => mockFetchUserSelectedCourseCodes(...args),
}));

describe('CalendarScreen', () => {
  beforeEach(() => {
    mockFetchCourseData.mockResolvedValue([
      {
        course_code: '12001104-003',
        title: 'Academic Writing',
        title_short: 'ACADEMIC WRITING',
        professor: 'Greco',
        term: 'Fall',
        academic_year: 2025,
        time_slot: 'Thu 14:55 - 16:25',
      },
    ]);

    mockFetchUserSelectedCourseCodes.mockResolvedValue([{ code: '12001104-003', year: 2025, term: 'Fall' }]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('maps selected courses into the period/day grid', async () => {
    render(<CalendarScreen />);

    await waitFor(() => {
      expect(screen.getByText('12001104-003')).toBeTruthy();
    });

    expect(mockFetchUserSelectedCourseCodes).toHaveBeenCalledWith('user-1', 2025, 'Fall');
  }, 15000);
});
