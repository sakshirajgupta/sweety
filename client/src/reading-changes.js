// Send the fields the user changed, not a stale copy of the entire reading.
export function readingChanges(original, next) {
  return Object.fromEntries(
    ['date', 'slot', 'value']
      .filter(key => next[key] !== original[key])
      .map(key => [key, next[key]])
  );
}
