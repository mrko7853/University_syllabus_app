import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Course } from '@/src/types/course';
import { colors, radii, spacing } from '@/src/theme/tokens';
import { getCourseColorByType, normalizeCourseTitle } from '@/src/utils/course';

interface CourseDetailModalProps {
  visible: boolean;
  course: Course | null;
  onClose: () => void;
}

function asText(value: string | number | null | undefined, fallback = 'N/A'): string {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

export function CourseDetailModal({ visible, course, onClose }: CourseDetailModalProps) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Course Details</Text>
            <Pressable onPress={onClose}>
              <Text style={styles.close}>Close</Text>
            </Pressable>
          </View>

          {!course ? null : (
            <ScrollView contentContainerStyle={styles.content}>
              <View style={[styles.colorDot, { backgroundColor: getCourseColorByType(course.type) }]} />
              <Text style={styles.code}>{asText(course.course_code)}</Text>
              <Text style={styles.title}>{normalizeCourseTitle(course.title)}</Text>
              <Text style={styles.meta}>Professor: {asText(course.professor, 'TBA')}</Text>
              <Text style={styles.meta}>Time: {asText(course.time_slot)}</Text>
              <Text style={styles.meta}>Location: {asText(course.location, 'Unknown')}</Text>
              <Text style={styles.meta}>Type: {asText(course.type, 'General')}</Text>

              <View style={styles.gpaBox}>
                <Text style={styles.gpaTitle}>GPA Distribution</Text>
                <Text style={styles.gpaLine}>A: {asText(course.gpa_a_percent, 'N/A')}%</Text>
                <Text style={styles.gpaLine}>B: {asText(course.gpa_b_percent, 'N/A')}%</Text>
                <Text style={styles.gpaLine}>C: {asText(course.gpa_c_percent, 'N/A')}%</Text>
                <Text style={styles.gpaLine}>D: {asText(course.gpa_d_percent, 'N/A')}%</Text>
                <Text style={styles.gpaLine}>F: {asText(course.gpa_f_percent, 'N/A')}%</Text>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modal: {
    maxHeight: '85%',
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingBottom: spacing.lg,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  close: {
    color: colors.primary,
    fontWeight: '600',
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
  colorDot: {
    width: 24,
    height: 24,
    borderRadius: 999,
    marginBottom: spacing.xs,
  },
  code: {
    color: colors.subtleText,
    fontSize: 12,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  meta: {
    color: colors.text,
    fontSize: 14,
  },
  gpaBox: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: colors.bg,
  },
  gpaTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: spacing.xs,
    color: colors.text,
  },
  gpaLine: {
    color: colors.subtleText,
  },
});
