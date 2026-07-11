import { Sequelize } from "sequelize";
import dotenv from "dotenv";

dotenv.config();

console.log("DB:", {
  host: "localhost",
  database: "root",
  user: "Raj357753",
});

/* export const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASS,
  {
    host: process.env.DB_HOST,
    dialect: "mysql",
    logging: false,
  }
); */
export const sequelize = new Sequelize(
    "ulov",
    "root",
    "Raj357753",
    {
      host: "localhost",
      dialect: "mysql",
      logging: false,
      pool: {
        max: 20,
        min: 2,
        acquire: 30000,
        idle: 10000,
      },
    }
  );

