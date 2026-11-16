import { Op } from "sequelize";
import { User } from "../models/User.js";
import { FEMALE_LANGUAGE_OPTIONS } from "../constants/languages.js";
import { parseLanguages } from "../services/appSettings.service.js";

const attributes = ["id", "publicUserId", "username", "name", "nickname", "phone", "languages", "accountStatus"];
const femaleOnly = { gender: { [Op.in]: ["Female", "female"] } };
const serialize = (user) => {
  const row = user.get ? user.get({ plain: true }) : user;
  return Object.fromEntries(attributes.map((key) => [key, key === "languages" ? parseLanguages(row[key]) : row[key]]));
};

export const listFemaleDetails = async (req, res) => {
  try {
    const search = String(req.query.search || "").trim().slice(0, 100);
    const page = Math.max(0, Math.min(100000, Number.parseInt(req.query.page, 10) || 0));
    const pageSize = Math.max(1, Math.min(50, Number.parseInt(req.query.pageSize, 10) || 25));
    const where = { ...femaleOnly };
    if (search) {
      // Bind through Sequelize; treat SQL wildcard characters as literal input.
      const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
      where[Op.or] = ["username", "nickname", "name", "phone", "publicUserId"].map((key) => ({ [key]: { [Op.like]: pattern } }));
      if (/^[1-9]\d*$/.test(search)) where[Op.or].push({ id: search });
    }
    const { rows, count } = await User.findAndCountAll({ where, attributes, order: [["id", "DESC"]], limit: pageSize, offset: page * pageSize });
    return res.json({ rows: rows.map(serialize), total: count });
  } catch (error) {
    console.error("LIST FEMALE DETAILS ERROR", error);
    return res.status(500).json({ message: "Unable to load female details" });
  }
};

export const updateFemaleDetails = async (req, res) => {
  if (!/^[1-9]\d*$/.test(String(req.params.id))) return res.status(400).json({ message: "Invalid user ID" });
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["username", "nickname", "languages"].includes(key))) {
    return res.status(400).json({ message: "Only username, display name and languages can be updated" });
  }
  if (typeof body.username !== "string" || !body.username.trim() || body.username.trim().length > 64 || /[\u0000-\u001f\u007f]/u.test(body.username)) {
    return res.status(400).json({ message: "Username must contain 1–64 characters without control characters" });
  }
  if (typeof body.nickname !== "string" || body.nickname.trim().length > 100 || /[\u0000-\u001f\u007f]/u.test(body.nickname)) {
    return res.status(400).json({ message: "Display name must be at most 100 characters without control characters" });
  }
  const allowed = new Set(FEMALE_LANGUAGE_OPTIONS.map((value) => value.toLowerCase()));
  if (!Array.isArray(body.languages) || !body.languages.length || body.languages.length > allowed.size || body.languages.some((value) => typeof value !== "string" || !allowed.has(value.trim().toLowerCase()))) {
    return res.status(400).json({ message: "Select a primary language and valid additional languages" });
  }
  const changes = { username: body.username.trim(), nickname: body.nickname.trim() || null, languages: [...new Set(body.languages.map((value) => value.trim().toLowerCase()))] };
  try {
    const user = await User.findOne({ where: { ...femaleOnly, id: req.params.id }, attributes });
    if (!user) return res.status(404).json({ message: "Female user not found" });
    const duplicate = await User.findOne({ where: { username: changes.username, id: { [Op.ne]: req.params.id } }, attributes: ["id"] });
    if (duplicate) return res.status(409).json({ message: "This username is already in use" });
    await user.update(changes, { fields: ["username", "nickname", "languages"] });
    return res.json({ message: "Female details updated", user: serialize(user) });
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") return res.status(409).json({ message: "This username is already in use" });
    console.error("UPDATE FEMALE DETAILS ERROR", error);
    return res.status(500).json({ message: "Unable to update female details" });
  }
};
