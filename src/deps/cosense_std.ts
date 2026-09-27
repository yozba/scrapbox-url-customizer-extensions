/**
 * Centralized Cosense UserScript helpers.
 *
 * Keep all @cosense/std subpath imports in this file. The package exposes DOM
 * and REST helpers from separate entry points, so its version appears twice
 * here but nowhere else in the application source.
 */
export { insertText } from "jsr:@cosense/std@^0.29.16/browser/dom";
export {
  getGyazoToken,
  getProject,
  uploadToGCS,
} from "jsr:@cosense/std@^0.29.16/rest";
