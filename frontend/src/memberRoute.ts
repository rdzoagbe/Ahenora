import type { FamilyMember } from './api';

/**
 * Where tapping a person goes: their profile, with the chat thread it should
 * open. Shared by the Family tab and the faces at the top of Home, so a face
 * opens the same page from either.
 *
 * Parents share the adults thread; a teen's thread is keyed by their own
 * user_id (matched by id, never by display name — two teens named the same
 * used to collide). A teen with no account yet has no thread, and a helper or
 * named member has no chat — the server refuses them family chat — so they get
 * an empty thread and the profile shows who they are instead.
 */
export function memberRoute(m: FamilyMember) {
  const roleLc = (m.role || '').toLowerCase();
  let thread = '';
  if (roleLc === 'parent' || roleLc === 'co-parent') thread = 'adults';
  else if (roleLc === 'teen') thread = m.user_id || '';
  return { pathname: '/member' as const, params: { id: m.member_id, name: m.name, role: m.role, thread } };
}
