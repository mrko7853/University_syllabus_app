import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Assignment, AssignmentStatus, AssignmentWritePayload } from '@/src/types/assignment';
import { colors, radii, spacing } from '@/src/theme/tokens';
import { formatDateInputValue, normalizeDateForStorage, parseDateFromInputValue } from '@/src/utils/date';

export interface AssignmentCourseOption {
  code: string;
  title: string;
  color: string;
  year: number;
  term: string;
}

interface AssignmentEditorModalProps {
  visible: boolean;
  assignment: Assignment | null;
  submitting: boolean;
  courseOptions: AssignmentCourseOption[];
  onClose: () => void;
  onSave: (payload: AssignmentWritePayload, editingAssignment: Assignment | null) => Promise<void>;
  onDelete: (assignmentId: string) => Promise<void>;
}

const statusOptions: AssignmentStatus[] = ['not_started', 'ongoing', 'completed'];

function statusLabel(status: AssignmentStatus): string {
  if (status === 'not_started') return 'Not Started';
  if (status === 'ongoing') return 'Ongoing';
  return 'Completed';
}

export function AssignmentEditorModal({
  visible,
  assignment,
  submitting,
  courseOptions,
  onClose,
  onSave,
  onDelete,
}: AssignmentEditorModalProps) {
  const [title, setTitle] = useState('');
  const [dueDateInput, setDueDateInput] = useState('');
  const [status, setStatus] = useState<AssignmentStatus>('not_started');
  const [instructions, setInstructions] = useState('');
  const [courseCode, setCourseCode] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;

    setTitle(assignment?.title ?? '');
    setDueDateInput(assignment?.due_date ? assignment.due_date.split('T')[0] : formatDateInputValue(new Date()));
    setStatus((assignment?.status as AssignmentStatus) ?? 'not_started');
    setInstructions(assignment?.instructions ?? '');
    setCourseCode(assignment?.course_code ?? null);
  }, [assignment, visible]);

  const selectedCourse = useMemo(() => {
    if (!courseCode) return null;
    return courseOptions.find((course) => course.code === courseCode) ?? null;
  }, [courseCode, courseOptions]);

  const save = async () => {
    const parsedDueDate = dueDateInput ? parseDateFromInputValue(dueDateInput) : null;
    const normalized = parsedDueDate ? normalizeDateForStorage(parsedDueDate) : null;

    const payload: AssignmentWritePayload = {
      title: title.trim() || 'Untitled Assignment',
      due_date: normalized ? normalized.toISOString() : null,
      status,
      instructions,
      course_code: selectedCourse?.code ?? null,
      course_tag_name: selectedCourse?.title ?? null,
      course_tag_color: selectedCourse?.color ?? '#e0e0e0',
      course_year: selectedCourse ? String(selectedCourse.year) : null,
      course_term: selectedCourse?.term ?? null,
      assignment_icon: assignment?.assignment_icon ?? '📄',
    };

    await onSave(payload, assignment);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{assignment ? 'Edit Assignment' : 'New Assignment'}</Text>
            <Pressable onPress={onClose}>
              <Text style={styles.link}>Close</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            <TextInput value={title} onChangeText={setTitle} placeholder="Title" style={styles.input} />

            <Text style={styles.label}>Due Date (YYYY-MM-DD)</Text>
            <TextInput
              value={dueDateInput}
              onChangeText={setDueDateInput}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
              style={styles.input}
            />

            <Text style={styles.label}>Status</Text>
            <View style={styles.statusRow}>
              {statusOptions.map((option) => (
                <Pressable
                  key={option}
                  style={[styles.statusButton, status === option && styles.statusButtonActive]}
                  onPress={() => setStatus(option)}
                >
                  <Text style={[styles.statusText, status === option && styles.statusTextActive]}>{statusLabel(option)}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Course</Text>
            <View style={styles.courseList}>
              <Pressable
                style={[styles.courseOption, !courseCode && styles.courseOptionActive]}
                onPress={() => setCourseCode(null)}
              >
                <Text style={[styles.courseOptionText, !courseCode && styles.courseOptionTextActive]}>None</Text>
              </Pressable>

              {courseOptions.map((course) => {
                const selected = course.code === courseCode;
                return (
                  <Pressable
                    key={course.code}
                    style={[styles.courseOption, selected && styles.courseOptionActive]}
                    onPress={() => setCourseCode(course.code)}
                  >
                    <View style={[styles.courseColor, { backgroundColor: course.color }]} />
                    <Text style={[styles.courseOptionText, selected && styles.courseOptionTextActive]}>{course.title}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.label}>Instructions</Text>
            <TextInput
              value={instructions}
              onChangeText={setInstructions}
              placeholder="Add instructions"
              multiline
              numberOfLines={5}
              style={[styles.input, styles.textArea]}
            />

            <Pressable style={styles.saveButton} onPress={save} disabled={submitting}>
              <Text style={styles.saveButtonText}>{submitting ? 'Saving...' : 'Save Assignment'}</Text>
            </Pressable>

            {assignment ? (
              <Pressable
                style={styles.deleteButton}
                onPress={() => {
                  void onDelete(assignment.id);
                }}
                disabled={submitting}
              >
                <Text style={styles.deleteButtonText}>Delete Assignment</Text>
              </Pressable>
            ) : null}
          </ScrollView>
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
    maxHeight: '90%',
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    padding: spacing.md,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  link: {
    color: colors.primary,
    fontWeight: '600',
  },
  content: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.subtleText,
    marginTop: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: '#fff',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
  },
  textArea: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statusButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: '#fff',
  },
  statusButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  statusText: {
    color: colors.text,
    fontSize: 13,
  },
  statusTextActive: {
    color: '#fff',
  },
  courseList: {
    gap: spacing.xs,
  },
  courseOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  courseOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.accent,
  },
  courseOptionText: {
    fontSize: 13,
    color: colors.text,
    flexShrink: 1,
  },
  courseOptionTextActive: {
    fontWeight: '700',
  },
  courseColor: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  saveButton: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  deleteButton: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.dangerText,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
  },
  deleteButtonText: {
    color: colors.dangerText,
    fontWeight: '700',
  },
});
