const { types } = require('pg');

// PostgreSQL DATE is a calendar day, not a moment in time.
// Keep its wire value as YYYY-MM-DD instead of creating a local-midnight Date.
// Timestamp columns retain pg's standard parsers.
module.exports = {
  getTypeParser(oid, format) {
    if (oid === types.builtins.DATE && (!format || format === 'text')) {
      return value => value;
    }
    return types.getTypeParser(oid, format);
  },
};
