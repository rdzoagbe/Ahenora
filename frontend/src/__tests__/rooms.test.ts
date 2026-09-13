/**
 * Tasks by room, on the client side.
 *
 * The room itself is a closed vocabulary the server enforces, so nothing here
 * re-tests that. What IS client-only, and what can actually be wrong, is the
 * filter's behaviour as the day goes on: rooms appear as tasks are added and
 * disappear as they are ticked off, and the row that offers them comes and
 * goes with them.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { ROOMS, keepRoomFilter, roomFilterWorthShowing, roomsInUse } from '../rooms';

describe('which rooms are in play', () => {
  it('lists only the rooms that have a task in them', () => {
    expect(roomsInUse([{ room: 'kitchen' }, { room: '' }, { room: 'garden' }]))
      .toEqual(['kitchen', 'garden']);
  });

  it('counts a room once however many tasks are in it', () => {
    expect(roomsInUse([{ room: 'kitchen' }, { room: 'kitchen' }, { room: 'kitchen' }]))
      .toEqual(['kitchen']);
  });

  it('offers them in the app’s own order, not the order they were added', () => {
    // The chips are read left to right. Ordering them by whichever task
    // happened to be created first makes the row move under the reader.
    expect(roomsInUse([{ room: 'garage' }, { room: 'kitchen' }, { room: 'bathroom' }]))
      .toEqual(['kitchen', 'bathroom', 'garage']);
  });

  it('treats a missing or null room as no room', () => {
    expect(roomsInUse([{}, { room: null }, { room: undefined }])).toEqual([]);
  });
});

describe('whether the row earns its place', () => {
  it('stays hidden for a household that never sets a room', () => {
    expect(roomFilterWorthShowing([])).toBe(false);
  });

  it('stays hidden when everything is in one room', () => {
    // A filter whose only option is "kitchen" filters nothing.
    expect(roomFilterWorthShowing(['kitchen'])).toBe(false);
  });

  it('appears once there is an actual choice', () => {
    expect(roomFilterWorthShowing(['kitchen', 'garden'])).toBe(true);
  });
});

describe('a filter that stops being offered', () => {
  it('is dropped when its room empties out', () => {
    // The trap: tick off the last bathroom job, the row drops to one room and
    // hides — taking away the only control that could clear the filter. What
    // is left is an empty list with no reason given and no way out.
    expect(keepRoomFilter('bathroom', ['kitchen'])).toBe('');
  });

  it('is kept while its room still has something in it', () => {
    expect(keepRoomFilter('bathroom', ['kitchen', 'bathroom'])).toBe('bathroom');
  });

  it('leaves "all rooms" alone', () => {
    expect(keepRoomFilter('', ['kitchen', 'bathroom'])).toBe('');
  });
});

describe('the composer and the Feed speak of the same rooms', () => {
  const modal = readFileSync(
    join(__dirname, '..', 'components', 'AddCardModal.tsx'), 'utf8');
  const feed = readFileSync(
    join(__dirname, '..', '..', 'app', '(tabs)', 'feed.tsx'), 'utf8');

  it('drives its chips from the list rather than from a hand-written row', () => {
    // The honest version of "every room gets a chip": the row is a map over
    // ROOMS, so adding a room to the vocabulary adds its chip. A hand-written
    // row is how a room ends up in the type, accepted by the server, and
    // impossible to actually choose.
    expect(modal).toContain('ROOMS.map(');
    expect(modal).toContain('testID={`room-${r}`}');
    // And the Feed's filter is a map over the rooms in use, not a fixed row.
    expect(feed).toContain('rooms.map(');
    expect(feed).toContain('testID={`feed-room-${r}`}');
  });

  it('neither screen keeps its own copy of the list', () => {
    // Two copies drift, and they drift towards one screen offering a room the
    // other cannot display.
    expect(modal).toContain("from '../rooms'");
    expect(feed).toContain("from '../../src/rooms'");
    expect(modal).not.toMatch(/const ROOMS\s*[:=]/);
    expect(feed).not.toMatch(/const ROOMS\s*[:=]/);
  });

  it('names every room in every language', () => {
    const i18n = readFileSync(join(__dirname, '..', 'i18n.ts'), 'utf8');
    ROOMS.forEach((r) => {
      // Four dicts: en, es, fr, de. A room named in only one of them shows an
      // untranslated key as a chip label to everybody else.
      const hits = i18n.split(`room_${r}:`).length - 1;
      expect([r, hits]).toEqual([r, 4]);
    });
    expect(i18n.split('room_all:').length - 1).toBe(4);
  });
});
