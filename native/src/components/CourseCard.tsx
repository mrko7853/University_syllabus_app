import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Course } from '@/src/types/course';
import { getCourseColorByType, normalizeCourseTitle } from '@/src/utils/course';
import { spacing } from '@/src/theme/tokens';

interface CourseCardProps {
  course: Course;
  subtitle: string;
  onPress: (course: Course) => void;
}

function getGpaFooterLabel(course: Course): string {
  if (course.gpa_a_percent === null || course.gpa_a_percent === undefined) {
    return 'GPA N/A';
  }

  return `GPA A ${Math.round(course.gpa_a_percent)}%`;
}

export function CourseCard({ course, subtitle, onPress }: CourseCardProps) {
  return (
    <Pressable testID="course-card" style={styles.shell} onPress={() => onPress(course)}>
      <View style={[styles.card, { backgroundColor: getCourseColorByType(course.type) }]}>
        <View style={styles.cardMain}>
          <Text style={styles.title}>{normalizeCourseTitle(course.title)}</Text>

          <View style={styles.metaBlock}>
            <View style={styles.metaRow}>
              <FontAwesome6 name="graduation-cap" size={18} color="#0f172a" />
              <Text style={styles.metaText}>{(course.professor || 'Professor TBA').toUpperCase()}</Text>
            </View>

            <View style={styles.metaRow}>
              <MaterialCommunityIcons name="calendar-clock-outline" size={22} color="#0f172a" />
              <Text style={styles.metaText}>{subtitle}</Text>
            </View>
          </View>
        </View>

        <View style={styles.gpaFooter}>
          <Text style={styles.gpaFooterText}>{getGpaFooterLabel(course)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: '#d7cedf',
    borderRadius: 28,
    padding: 14,
    marginBottom: spacing.md,
  },
  card: {
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#4a3f58',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  cardMain: {
    minHeight: 250,
    paddingHorizontal: 18,
    paddingTop: 22,
    paddingBottom: 16,
  },
  title: {
    color: '#0f172a',
    fontSize: 24,
    lineHeight: 33,
    fontWeight: '700',
    fontFamily: Platform.select({
      ios: 'Times New Roman',
      android: 'serif',
      default: 'serif',
    }),
    marginBottom: 26,
  },
  metaBlock: {
    gap: 22,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  metaText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
  },
  gpaFooter: {
    backgroundColor: '#d8d1dd',
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.05)',
  },
  gpaFooterText: {
    textAlign: 'center',
    color: '#666666',
    fontSize: 20,
    fontWeight: '700',
  },
});
