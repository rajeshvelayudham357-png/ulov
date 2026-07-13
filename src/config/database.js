import path from "path";
import { fileURLToPath } from "url";

import dotenv from "dotenv";
import { Sequelize } from "sequelize";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.join(__dirname, ".env"),
});

dotenv.config();

const dbName = process.env.DB_NAME || "ulov";
const dbUser = process.env.DB_USER || "root";
const dbPass = process.env.DB_PASS || "";
const dbHost = process.env.DB_HOST || "localhost";

console.log("DB:", {
  host: dbHost,
  database: dbName,
  user: dbUser,
});

export const sequelize = new Sequelize(dbName, dbUser, dbPass, {
  host: dbHost,
  dialect: "mysql",
  logging: process.env.DB_LOGGING === "true" ? console.log : false,
  pool: {
    max: 20,
    min: 2,
    acquire: 30000,
    idle: 10000,
  },
});
