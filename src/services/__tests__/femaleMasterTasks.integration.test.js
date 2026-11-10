/**
 * Admin master tasks: editing, validation and soft delete.
 * Run against a disposable schema, e.g. DB_NAME=ulov_billing_test.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { sequelize } from "../../config/database.js";
import {
  claimFemaleTaskReward,
  createMasterFemaleTask,
  deleteMasterFemaleTask,
  getMasterFemaleTasks,
  updateMasterFemaleTask,
} from "../femaleTask.service.js";

const TITLE = "ZZ Admin Edit Test Task";
const created = [];

test.after(async () => {
  if (created.length) {
    await sequelize.query("DELETE FROM female_master_tasks WHERE id IN (:ids)", {
      replacements: { ids: created },
    });
  }
  await sequelize.close();
});

test("an admin can edit every field of a task", async () => {
  const task = await createMasterFemaleTask({
    title: TITLE,
    description: "Before",
    rewardCoins: 10,
    cadence: "daily",
    requirements: { minCalls: 2 },
  });
  created.push(task.id);

  const updated = await updateMasterFemaleTask(task.id, {
    title: `${TITLE} edited`,
    description: "After",
    rewardCoins: 75,
    cadence: "lifetime",
    requirements: { minOnlineMinutes: 240, loggedIn: true },
  });

  assert.equal(updated.title, `${TITLE} edited`);
  assert.equal(updated.description, "After");
  assert.equal(updated.rewardCoins, 75);
  assert.equal(updated.cadence, "lifetime");
  assert.deepEqual(updated.requirements, { minOnlineMinutes: 240, loggedIn: true });
  assert.equal(updated.id, task.id, "editing keeps the id, so past claims stay linked");
});

test("edits are validated", async () => {
  const [id] = created;
  await assert.rejects(() => updateMasterFemaleTask(id, { title: "  " }), /title is required/);
  await assert.rejects(() => updateMasterFemaleTask(id, { rewardCoins: -5 }), /cannot be negative/);
  await assert.rejects(() => updateMasterFemaleTask(id, { cadence: "weekly" }), /daily or lifetime/);
});

test("a deleted task disappears from the admin list and the app and can't be claimed", async () => {
  const [id] = created;
  await updateMasterFemaleTask(id, { active: true });
  assert.ok((await getMasterFemaleTasks()).some((task) => task.id === id), "visible in app before delete");

  assert.deepEqual(await deleteMasterFemaleTask(id), { id, deleted: true });

  assert.ok(!(await getMasterFemaleTasks()).some((task) => task.id === id), "hidden from the app");
  assert.ok(
    !(await getMasterFemaleTasks({ includeInactive: true })).some((task) => task.id === id),
    "hidden from the admin list"
  );
  assert.ok(
    (await getMasterFemaleTasks({ includeInactive: true, includeDeleted: true })).some((task) => task.id === id),
    "kept for claim history"
  );

  await assert.rejects(() => deleteMasterFemaleTask(id), /not found/);
  await assert.rejects(() => updateMasterFemaleTask(id, { title: "Revive" }), /not found/);
  await assert.rejects(() => claimFemaleTaskReward(887999, id), /not found/i);
});

test("a new task never reuses a deleted task's id", async () => {
  const again = await createMasterFemaleTask({ title: TITLE, rewardCoins: 5 });
  created.push(again.id);
  assert.notEqual(again.id, created[0]);
});
