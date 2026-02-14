import { supabase } from '@/src/lib/supabase';
import type { Assignment, AssignmentWritePayload } from '@/src/types/assignment';

export async function fetchAssignments(userId: string): Promise<Assignment[]> {
  const { data, error } = await supabase
    .from('assignments')
    .select('*')
    .eq('user_id', userId)
    .order('due_date', { ascending: true });

  if (error) throw error;
  return (data as Assignment[]) ?? [];
}

export async function createAssignment(userId: string, payload: AssignmentWritePayload): Promise<Assignment> {
  const { data, error } = await supabase
    .from('assignments')
    .insert([{ user_id: userId, ...payload }])
    .select()
    .single();

  if (error) throw error;
  return data as Assignment;
}

export async function updateAssignment(
  id: string,
  userId: string,
  payload: AssignmentWritePayload
): Promise<Assignment> {
  const { data, error } = await supabase
    .from('assignments')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw error;
  return data as Assignment;
}

export async function deleteAssignment(id: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('assignments')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) throw error;
}
