import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Course } from '@/src/types/course';
import { colors, radii, spacing } from '@/src/theme/tokens';
import { getCourseColorByType, normalizeCourseTitle } from '@/src/utils/course';

interface CourseCardProps {
  course: Course;
  subtitle: string;
  onPress: (course: Course) => void;
}

function toPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A';
  return `${Math.round(value)}%`;
}

export function CourseCard({ course, subtitle, onPress }: CourseCardProps) {
  return (
    <Pressable
      testID="course-card"
      style={[styles.card, { borderLeftColor: getCourseColorByType(course.type), borderLeftWidth: 6 }]}
      onPress={() => onPress(course)}
    >
      <Text style={styles.code}>{course.course_code}</Text>
      <Text style={styles.title}>{normalizeCourseTitle(course.title)}</Text>
      <Text style={styles.meta}>{course.professor ? `Professor ${course.professor}` : 'Professor TBA'}</Text>
      <Text style={styles.meta}>{subtitle}</Text>

      <View style={styles.gpaRow}>
        <Text style={styles.gpaLabel}>A {toPercent(course.gpa_a_percent)}</Text>
        <Text style={styles.gpaLabel}>B {toPercent(course.gpa_b_percent)}</Text>
        <Text style={styles.gpaLabel}>C {toPercent(course.gpa_c_percent)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: 2,
  },
  code: {
    fontSize: 12,
    color: colors.subtleText,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  meta: {
    fontSize: 13,
    color: colors.subtleText,
  },
  gpaRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  gpaLabel: {
    fontSize: 12,
    color: colors.text,
  },
});
