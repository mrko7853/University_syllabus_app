import { ScrollView, Pressable, StyleSheet, Text } from 'react-native';
import type { Semester } from '@/src/types/course';
import { colors, radii, spacing } from '@/src/theme/tokens';

interface SemesterChipsProps {
  semesters: Semester[];
  selectedSemester: Semester | null;
  onSelect: (semester: Semester) => void;
}

export function SemesterChips({ semesters, selectedSemester, onSelect }: SemesterChipsProps) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.container}>
      {semesters.map((semester) => {
        const selected = selectedSemester?.term === semester.term && selectedSemester?.year === semester.year;

        return (
          <Pressable
            key={`${semester.term}-${semester.year}`}
            onPress={() => onSelect(semester)}
            style={[styles.chip, selected && styles.chipSelected]}
          >
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{semester.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  chip: {
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: '#fff',
  },
});
