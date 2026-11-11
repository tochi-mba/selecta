import base from './playwright.config';

// Area B scratch: reuse an already-running server on SELECTA_E2E_PORT (renders stay cached). Delete before commit.
export default { ...base, webServer: undefined };
