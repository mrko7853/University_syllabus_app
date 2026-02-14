import { StyleSheet, Text, View } from 'react-native';
import type { AssignmentStatus } from '@/src/types/assignment';
import { colors, radii, spacing } from '@/src/theme/tokens';

const statusLabels: Record<AssignmentStatus, string> = {
  not_started: 'Not Started',
  ongoing: 'Ongoing',
  completed: 'Completed',
};

const statusColors: Record<AssignmentStatus, { bg: string; text: string }> = {
  not_started: { bg: colors.muted, text: colors.mutedText },
  ongoing: { bg: colors.warn, text: colors.warnText },
  completed: { bg: colors.success, text: colors.successText },
};

export function AssignmentStatusBadge({ status }: { status: AssignmentStatus }) {
  const palette = statusColors[status];

  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[styles.label, { color: palette.text }]}>{statusLabels[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.sm,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
});
