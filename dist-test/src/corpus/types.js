/**
 * The pubid-testsuite wire contract (schema/test.schema.yaml is the
 * authority; these types mirror it exactly). Every field is optional at
 * the schema level except id - the loader normalises to explicit
 * optionals rather than lying about shapes.
 */
export function isErrorCase(testCase) {
    return testCase.expect?.error !== undefined;
}
/** Reference-bug debt: nothing to gate on. */
export function isQuarantined(testCase) {
    return testCase.identifier === undefined && !isErrorCase(testCase);
}
export function isReview(testCase) {
    return (testCase.review ?? "") !== "";
}
