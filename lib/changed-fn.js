/**
 * @param {string} name
 * @param {Change<DataSnapshot>} change
 * @return {boolean}
 */
module.exports = function (name, change) {
  const beforeVal = change.before.val() || {};
  const afterVal = change.after.val() || {};
  if (beforeVal.hasOwnProperty(name) && afterVal.hasOwnProperty(name)) {
    return beforeVal[name] !== afterVal[name]
  }
  return beforeVal.hasOwnProperty(name) || afterVal.hasOwnProperty(name)
};
