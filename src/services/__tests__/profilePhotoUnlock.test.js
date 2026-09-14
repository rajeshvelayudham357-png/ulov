import test from "node:test";
import assert from "node:assert/strict";

import { isProfilePhotoUploadAllowed } from "../../constants/profilePhoto.js";

test("profile photos stay locked below level 3 without purchase", () => {
  assert.equal(
    isProfilePhotoUploadAllowed({ profilePhotoUnlocked: false }, { level: 0 }),
    false
  );
});

test("profile photos unlock at level 3", () => {
  assert.equal(
    isProfilePhotoUploadAllowed({ profilePhotoUnlocked: false }, { level: 3 }),
    true
  );
});

test("profile photos unlock after coin purchase even at level 0", () => {
  assert.equal(
    isProfilePhotoUploadAllowed({ profilePhotoUnlocked: true }, { level: 0 }),
    true
  );
});
