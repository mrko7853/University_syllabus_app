import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AssignmentEditorModal, type AssignmentCourseOption } from '@/src/components/AssignmentEditorModal';
import { AssignmentStatusBadge } from '@/src/components/AssignmentStatusBadge';
import { SemesterChips } from '@/src/components/SemesterChips';
import { useAuth } from '@/src/context/AuthContext';
import { useSemester } from '@/src/context/SemesterContext';
import {
  createAssignment,
  deleteAssignment,
  fetchAssignments,
  updateAssignment,
} from '@/src/services/assignments';
import { fetchCourseData, fetchUserSelectedCourseCodes } from '@/src/services/courses';
import { colors, radii, spacing } from '@/src/theme/tokens';
import type { Assignment, AssignmentWritePayload } from '@/src/types/assignment';
import { getCourseColorByType } from '@/src/utils/course';
import { getMonthMatrix, toDateLabel } from '@/src/utils/date';

type AssignmentView = 'list' | 'calendar';

export function AssignmentsScreen() {
  const { user } = useAuth();
  const { semesters, selectedSemester, setSelectedSemester } = useSemester();

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);
  const [view, setView] = useState<AssignmentView>('list');
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [courseOptions, setCourseOptions] = useState<AssignmentCourseOption[]>([]);

  const loadAssignments = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const rows = await fetchAssignments(user.id);
      setAssignments(rows);
    } catch (error) {
      console.error('Failed to load assignments', error);
      setAssignments([]);
    } finally {
      setLoading(false);
    }
  };

  const loadCourseOptions = async () => {
    if (!user?.id || !selectedSemester) return;

    try {
      const [courses, selected] = await Promise.all([
        fetchCourseData(selectedSemester.year, selectedSemester.term),
        fetchUserSelectedCourseCodes(user.id, selectedSemester.year, selectedSemester.term),
      ]);

      const selectedCodes = new Set(selected.map((entry) => entry.code));
      const visible = courses.filter((course) => selectedCodes.has(course.course_code));

      const mapped: AssignmentCourseOption[] = visible.map((course) => ({
        code: course.course_code,
        title: course.title || course.course_code,
        color: getCourseColorByType(course.type),
        year: course.academic_year,
        term: course.term,
      }));

      setCourseOptions(mapped);
    } catch (error) {
      console.error('Failed to load assignment course options', error);
      setCourseOptions([]);
    }
  };

  useEffect(() => {
    void loadAssignments();
  }, [user?.id]);

  useEffect(() => {
    void loadCourseOptions();
  }, [user?.id, selectedSemester?.term, selectedSemester?.year]);

  const groupedByDay = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    assignments.forEach((assignment) => {
      if (!assignment.due_date) return;
      const key = new Date(assignment.due_date).toDateString();
      const existing = map.get(key) ?? [];
      existing.push(assignment);
      map.set(key, existing);
    });
    return map;
  }, [assignments]);

  const monthMatrix = useMemo(() => getMonthMatrix(calendarMonth), [calendarMonth]);

  const openCreate = () => {
    setEditingAssignment(null);
    setEditorVisible(true);
  };

  const openEdit = (assignment: Assignment) => {
    setEditingAssignment(assignment);
    setEditorVisible(true);
  };

  const handleSave = async (payload: AssignmentWritePayload, current: Assignment | null) => {
    if (!user?.id) return;

    try {
      if (current) {
        const updated = await updateAssignment(current.id, user.id, payload);
        setAssignments((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      } else {
        const created = await createAssignment(user.id, payload);
        setAssignments((prev) => [...prev, created].sort((a, b) => {
          const dueA = a.due_date ? Date.parse(a.due_date) : Number.MAX_SAFE_INTEGER;
          const dueB = b.due_date ? Date.parse(b.due_date) : Number.MAX_SAFE_INTEGER;
          return dueA - dueB;
        }));
      }
      setEditorVisible(false);
      setEditingAssignment(null);
    } catch (error) {
      console.error('Failed to save assignment', error);
    }
  };

  const handleDelete = async (assignmentId: string) => {
    if (!user?.id) return;

    try {
      await deleteAssignment(assignmentId, user.id);
      setAssignments((prev) => prev.filter((item) => item.id !== assignmentId));
      setEditorVisible(false);
      setEditingAssignment(null);
    } catch (error) {
      console.error('Failed to delete assignment', error);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Assignments</Text>
          <Pressable style={styles.newButton} onPress={openCreate}>
            <Text style={styles.newButtonText}>New</Text>
          </Pressable>
        </View>

        <SemesterChips semesters={semesters} selectedSemester={selectedSemester} onSelect={setSelectedSemester} />

        <View style={styles.viewToggleRow}>
          <Pressable style={[styles.toggleButton, view === 'list' && styles.toggleButtonActive]} onPress={() => setView('list')}>
            <Text style={[styles.toggleText, view === 'list' && styles.toggleTextActive]}>List</Text>
          </Pressable>
          <Pressable
            style={[styles.toggleButton, view === 'calendar' && styles.toggleButtonActive]}
            onPress={() => setView('calendar')}
          >
            <Text style={[styles.toggleText, view === 'calendar' && styles.toggleTextActive]}>Calendar</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : view === 'list' ? (
          <FlatList
            data={assignments}
            keyExtractor={(item) => item.id}
            contentContainerStyle={assignments.length === 0 ? styles.listEmptyContainer : undefined}
            renderItem={({ item }) => (
              <Pressable style={styles.assignmentRow} onPress={() => openEdit(item)}>
                <View style={styles.assignmentTopLine}>
                  <Text style={styles.assignmentTitle}>{item.assignment_icon || '📄'} {item.title}</Text>
                  <AssignmentStatusBadge status={item.status} />
                </View>
                <Text style={styles.assignmentMeta}>Due: {toDateLabel(item.due_date)}</Text>
                <View style={styles.assignmentSubjectWrap}>
                  <View
                    style={[
                      styles.subjectPill,
                      {
                        backgroundColor: item.course_tag_color || '#e0e0e0',
                      },
                    ]}
                  >
                    <Text style={styles.subjectText}>{item.course_tag_name || 'No course'}</Text>
                  </View>
                </View>
              </Pressable>
            )}
            ListEmptyComponent={<Text style={styles.empty}>No assignments yet.</Text>}
          />
        ) : (
          <View style={styles.calendarContainer}>
            <View style={styles.calendarHeaderRow}>
              <Pressable
                style={styles.monthNav}
                onPress={() => setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
              >
                <Text style={styles.monthNavText}>‹</Text>
              </Pressable>

              <Text style={styles.monthTitle}>
                {calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </Text>

              <Pressable
                style={styles.monthNav}
                onPress={() => setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
              >
                <Text style={styles.monthNavText}>›</Text>
              </Pressable>
            </View>

            <View style={styles.dayHeaderRow}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <Text key={day} style={styles.dayHeaderText}>{day}</Text>
              ))}
            </View>

            <ScrollView>
              {monthMatrix.map((week, weekIndex) => (
                <View key={`week-${weekIndex}`} style={styles.weekRow}>
                  {week.map((day, dayIndex) => {
                    if (!day) return <View key={`empty-${dayIndex}`} style={[styles.dayCell, styles.dayCellEmpty]} />;

                    const key = day.toDateString();
                    const dayAssignments = groupedByDay.get(key) ?? [];

                    return (
                      <View key={`${key}-${dayIndex}`} style={styles.dayCell}>
                        <Text style={styles.dayNumber}>{day.getDate()}</Text>
                        {dayAssignments.slice(0, 2).map((item) => (
                          <Pressable key={item.id} onPress={() => openEdit(item)} style={styles.calendarAssignmentPill}>
                            <Text numberOfLines={1} style={styles.calendarAssignmentText}>
                              {item.assignment_icon || '📄'} {item.title}
                            </Text>
                          </Pressable>
                        ))}
                        {dayAssignments.length > 2 ? (
                          <Text style={styles.moreLabel}>+{dayAssignments.length - 2}</Text>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </View>
        )}
      </View>

      <AssignmentEditorModal
        visible={editorVisible}
        assignment={editingAssignment}
        submitting={loading}
        courseOptions={courseOptions}
        onClose={() => {
          setEditorVisible(false);
          setEditingAssignment(null);
        }}
        onSave={handleSave}
        onDelete={handleDelete}
      />
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
  headerRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
  },
  newButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  newButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  viewToggleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  toggleButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: '#fff',
  },
  toggleButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  toggleText: {
    color: colors.text,
    fontWeight: '600',
  },
  toggleTextActive: {
    color: '#fff',
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignmentRow: {
    backgroundColor: '#fff',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  assignmentTopLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    alignItems: 'center',
  },
  assignmentTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  assignmentMeta: {
    color: colors.subtleText,
    fontSize: 13,
  },
  assignmentSubjectWrap: {
    marginTop: spacing.xs,
  },
  subjectPill: {
    alignSelf: 'flex-start',
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  subjectText: {
    fontSize: 12,
    color: colors.text,
    fontWeight: '600',
  },
  empty: {
    textAlign: 'center',
    color: colors.subtleText,
    paddingVertical: spacing.lg,
  },
  listEmptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  calendarContainer: {
    flex: 1,
  },
  calendarHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  monthNav: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  monthNavText: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 21,
  },
  monthTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  dayHeaderRow: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  dayHeaderText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    color: colors.subtleText,
    fontWeight: '700',
  },
  weekRow: {
    flexDirection: 'row',
  },
  dayCell: {
    flex: 1,
    minHeight: 92,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    padding: 4,
  },
  dayCellEmpty: {
    backgroundColor: colors.bg,
  },
  dayNumber: {
    fontSize: 12,
    color: colors.subtleText,
    marginBottom: 2,
  },
  calendarAssignmentPill: {
    backgroundColor: colors.accent,
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 2,
    marginBottom: 2,
  },
  calendarAssignmentText: {
    fontSize: 10,
    color: colors.text,
  },
  moreLabel: {
    fontSize: 10,
    color: colors.subtleText,
  },
});
