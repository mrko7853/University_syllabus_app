import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CourseDetailModal } from '@/src/components/CourseDetailModal';
import { SemesterChips } from '@/src/components/SemesterChips';
import { DAY_LABELS, PERIOD_DEFINITIONS, WEEKDAYS } from '@/src/constants/calendar';
import { useAuth } from '@/src/context/AuthContext';
import { useSemester } from '@/src/context/SemesterContext';
import { fetchCourseData, fetchUserSelectedCourseCodes } from '@/src/services/courses';
import { colors, radii, spacing } from '@/src/theme/tokens';
import type { Course } from '@/src/types/course';
import { getCourseColorByType, parseCourseSchedule } from '@/src/utils/course';

interface SlotCourseMap {
  [key: string]: Course[];
}

export function CalendarScreen() {
  const { user } = useAuth();
  const { semesters, selectedSemester, loading: semesterLoading, setSelectedSemester } = useSemester();

  const [slotCourses, setSlotCourses] = useState<SlotCourseMap>({});
  const [loading, setLoading] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!selectedSemester || !user?.id) return;
      setLoading(true);

      try {
        const [courses, selected] = await Promise.all([
          fetchCourseData(selectedSemester.year, selectedSemester.term),
          fetchUserSelectedCourseCodes(user.id, selectedSemester.year, selectedSemester.term),
        ]);

        const selectedCodeSet = new Set(selected.map((entry) => entry.code));
        const visibleCourses = courses.filter((course) => selectedCodeSet.has(course.course_code));

        const next: SlotCourseMap = {};
        visibleCourses.forEach((course) => {
          const parsed = parseCourseSchedule(course);
          if (!parsed) return;

          const key = `${parsed.dayEN}-${parsed.period}`;
          if (!next[key]) next[key] = [];
          next[key].push(course);
        });

        setSlotCourses(next);
      } catch (error) {
        console.error('Failed to load calendar courses', error);
        setSlotCourses({});
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [selectedSemester?.term, selectedSemester?.year, user?.id]);

  const isEmpty = useMemo(() => Object.keys(slotCourses).length === 0, [slotCourses]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Calendar</Text>
        <SemesterChips semesters={semesters} selectedSemester={selectedSemester} onSelect={setSelectedSemester} />

        {semesterLoading || loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={styles.headerRow}>
                <View style={[styles.timeCell, styles.headerCell]}>
                  <Text style={styles.headerText}>Period</Text>
                </View>
                {WEEKDAYS.map((day) => (
                  <View key={day} style={[styles.dayCell, styles.headerCell]}>
                    <Text style={styles.headerText}>{DAY_LABELS[day]}</Text>
                  </View>
                ))}
              </View>

              {PERIOD_DEFINITIONS.map((period) => (
                <View key={period.number} style={styles.periodRow}>
                  <View style={styles.timeCell}>
                    <Text style={styles.timeTitle}>{period.label}</Text>
                    <Text style={styles.timeRange}>{period.timeRange}</Text>
                  </View>

                  {WEEKDAYS.map((day) => {
                    const key = `${day}-${period.number}`;
                    const courses = slotCourses[key] || [];
                    const primary = courses[0] || null;

                    return (
                      <Pressable
                        key={key}
                        style={[
                          styles.dayCell,
                          styles.slotCell,
                          primary && { borderColor: getCourseColorByType(primary.type) },
                        ]}
                        onPress={() => {
                          if (primary) setSelectedCourse(primary);
                        }}
                      >
                        {primary ? (
                          <>
                            <Text style={styles.slotCourseCode}>{primary.course_code}</Text>
                            <Text numberOfLines={2} style={styles.slotCourseTitle}>
                              {primary.title_short || primary.title}
                            </Text>
                            {courses.length > 1 ? <Text style={styles.slotExtra}>+{courses.length - 1}</Text> : null}
                          </>
                        ) : (
                          <Text style={styles.emptySlot}>-</Text>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
        )}

        {!loading && isEmpty ? <Text style={styles.empty}>No selected courses for this semester.</Text> : null}

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
    paddingHorizontal: spacing.md,
    backgroundColor: colors.bg,
  },
  title: {
    marginTop: spacing.sm,
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerRow: {
    flexDirection: 'row',
  },
  periodRow: {
    flexDirection: 'row',
  },
  headerCell: {
    backgroundColor: colors.accent,
  },
  headerText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.subtleText,
  },
  timeCell: {
    width: 120,
    minHeight: 90,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    justifyContent: 'center',
  },
  dayCell: {
    width: 155,
    minHeight: 90,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  slotCell: {
    backgroundColor: '#fff',
    borderRadius: radii.sm,
  },
  timeTitle: {
    fontWeight: '700',
    color: colors.text,
    fontSize: 12,
  },
  timeRange: {
    color: colors.subtleText,
    fontSize: 12,
  },
  slotCourseCode: {
    fontSize: 11,
    color: colors.subtleText,
  },
  slotCourseTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    marginTop: 2,
  },
  slotExtra: {
    marginTop: spacing.xs,
    fontSize: 11,
    color: colors.subtleText,
  },
  emptySlot: {
    textAlign: 'center',
    marginTop: spacing.lg,
    color: colors.subtleText,
  },
  empty: {
    textAlign: 'center',
    marginTop: spacing.sm,
    color: colors.subtleText,
  },
});
