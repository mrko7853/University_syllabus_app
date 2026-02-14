import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CourseCard } from '@/src/components/CourseCard';
import { CourseDetailModal } from '@/src/components/CourseDetailModal';
import { SemesterChips } from '@/src/components/SemesterChips';
import { useAuth } from '@/src/context/AuthContext';
import { useSemester } from '@/src/context/SemesterContext';
import { fetchCourseData } from '@/src/services/courses';
import { PERIOD_DEFINITIONS } from '@/src/constants/calendar';
import type { Course } from '@/src/types/course';
import { colors, spacing } from '@/src/theme/tokens';
import { parseCourseSchedule } from '@/src/utils/course';

function getCourseTimeLabel(course: Course): string {
  const parsed = parseCourseSchedule(course);
  if (!parsed) return course.time_slot || 'Time TBA';

  const period = PERIOD_DEFINITIONS.find((item) => item.number === parsed.period);
  return `${parsed.dayEN} ${period?.timeRange ?? ''}`.trim();
}

export function CoursesScreen() {
  const { session } = useAuth();
  const { semesters, selectedSemester, loading: semesterLoading, setSelectedSemester, refreshSemesters } = useSemester();

  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);

  const loadCourses = async () => {
    if (!selectedSemester || !session?.user) return;
    setLoading(true);
    try {
      const data = await fetchCourseData(selectedSemester.year, selectedSemester.term);
      setCourses(data);
    } catch (error) {
      console.error('Failed to load courses', error);
      setCourses([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCourses();
  }, [selectedSemester?.term, selectedSemester?.year, session?.user?.id]);

  const filteredCourses = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return courses;

    return courses.filter((course) => {
      return (
        course.title?.toLowerCase().includes(search) ||
        course.professor?.toLowerCase().includes(search) ||
        course.course_code?.toLowerCase().includes(search)
      );
    });
  }, [courses, query]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Courses</Text>

        <SemesterChips semesters={semesters} selectedSemester={selectedSemester} onSelect={setSelectedSemester} />

        <TextInput
          style={styles.search}
          placeholder="Search title, professor, or code"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
        />

        {semesterLoading || loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <FlatList
            data={filteredCourses}
            keyExtractor={(item, index) => `${item.course_code}-${item.academic_year}-${index}`}
            renderItem={({ item }) => (
              <CourseCard course={item} subtitle={getCourseTimeLabel(item)} onPress={setSelectedCourse} />
            )}
            refreshControl={
              <RefreshControl
                refreshing={loading}
                onRefresh={async () => {
                  await refreshSemesters();
                  await loadCourses();
                }}
              />
            }
            ListEmptyComponent={<Text style={styles.empty}>No courses found for this semester.</Text>}
            contentContainerStyle={filteredCourses.length === 0 ? styles.listEmptyContainer : undefined}
          />
        )}

        <CourseDetailModal visible={!!selectedCourse} course={selectedCourse} onClose={() => setSelectedCourse(null)} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
  },
  title: {
    marginTop: spacing.sm,
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
  },
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  empty: {
    color: colors.subtleText,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listEmptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
});
