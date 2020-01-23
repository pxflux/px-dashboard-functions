/**
 * @param {string} name
 * @param {Change<DataSnapshot>} change
 * @return {boolean}
 */
module.exports = function (name, change) {
  const beforeVal = change.before.val() || {};
  const afterVal = change.after.val() || {};
  if (name in beforeVal && name in afterVal) {
    return beforeVal[name] !== afterVal[name]
  }
  return name in beforeVal || name in afterVal
};
