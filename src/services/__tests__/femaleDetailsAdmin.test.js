import test from "node:test";
import assert from "node:assert/strict";
import { Op } from "sequelize";
import { User } from "../../models/User.js";
import { listFemaleDetails, updateFemaleDetails } from "../../controllers/femaleDetailsAdmin.controller.js";

const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const valid = { username: "New Name", nickname: "Display Name", languages: ["Tamil", "English"] };

test("updates only editable details, normalizes languages and preserves primary order", async (t) => {
  let lookup = 0;
  let saved;
  const user = { id: 12, username: "old", nickname: "old", languages: [], phone: "123", loginPinHash: "private", async update(values, options) { saved = { values, options }; Object.assign(this, values); } };
  t.mock.method(User, "findOne", async ({ where }) => {
    if (++lookup === 1) {
      assert.deepEqual(where.gender[Op.in], ["Female", "female"]);
      return user;
    }
    assert.equal(where.id[Op.ne], "12");
    return null;
  });
  const res = response();
  await updateFemaleDetails({ params: { id: "12" }, body: { ...valid, username: " New Name ", languages: ["Tamil", "English", "tamil"] } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(saved.values.languages, ["tamil", "english"]);
  assert.equal(saved.values.username, "New Name");
  assert.deepEqual(saved.options.fields, ["username", "nickname", "languages"]);
  assert.equal(res.body.user.loginPinHash, undefined);
});

test("rejects invalid fields and languages before any database write", async (t) => {
  t.mock.method(User, "findOne", () => { throw new Error("must not access database"); });
  for (const body of [null, [], { ...valid, gender: "Male" }, { ...valid, username: " " }, { ...valid, username: "x".repeat(65) }, { ...valid, languages: [] }, { ...valid, languages: ["not-a-language"] }, { ...valid, languages: [null] }, { ...valid, nickname: "x\n" }]) {
    const res = response();
    await updateFemaleDetails({ params: { id: "12" }, body }, res);
    assert.equal(res.code, 400);
  }
});

test("male or missing users cannot be edited", async (t) => {
  t.mock.method(User, "findOne", async ({ where }) => {
    assert.deepEqual(where.gender[Op.in], ["Female", "female"]);
    return null;
  });
  const res = response();
  await updateFemaleDetails({ params: { id: "12" }, body: valid }, res);
  assert.equal(res.code, 404);
});

test("duplicate username and concurrent unique conflict return useful errors", async (t) => {
  let calls = 0;
  const user = { update() { throw Object.assign(new Error("duplicate"), { name: "SequelizeUniqueConstraintError" }); } };
  t.mock.method(User, "findOne", async () => ++calls % 2 === 1 ? user : { id: 99 });
  let res = response();
  await updateFemaleDetails({ params: { id: "12" }, body: valid }, res);
  assert.equal(res.code, 409);
  t.mock.restoreAll();
  calls = 0;
  t.mock.method(User, "findOne", async () => ++calls % 2 === 1 ? user : null);
  res = response();
  await updateFemaleDetails({ params: { id: "12" }, body: valid }, res);
  assert.equal(res.code, 409);
});

test("listing is female-only, paginated and excludes private model fields", async (t) => {
  t.mock.method(User, "findAndCountAll", async (options) => {
    assert.deepEqual(options.where.gender[Op.in], ["Female", "female"]);
    assert.equal(options.limit, 50);
    assert.equal(options.offset, 50);
    assert.equal(options.where[Op.or][0].username[Op.like], "%name\\_%");
    assert.ok(!options.attributes.includes("loginPinHash"));
    return { count: 1, rows: [{ id: 12, languages: '["Tamil"]', loginPinHash: "private" }] };
  });
  const res = response();
  await listFemaleDetails({ query: { search: "name_", page: "1", pageSize: "500" } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.rows[0].languages, ["tamil"]);
  assert.equal(res.body.rows[0].loginPinHash, undefined);
});
