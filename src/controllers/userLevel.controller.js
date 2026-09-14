import {
  getLevelConfig,
  getTierOptions,
  listFemaleUserLevels,
  updateLevelConfig,
} from "../services/userLevel.service.js";
import { normalizeUserLevelGender } from "../constants/userLevel.js";

export const getUserLevelsAdmin = async (req, res) => {
  try {
    const gender = normalizeUserLevelGender(req.query.gender);

    if (!gender) {
      return res.status(400).json({
        message: "Query parameter gender must be male or female",
      });
    }

    const levels = await getLevelConfig(gender);

    return res.json({
      gender,
      levels,
      tiers: getTierOptions(),
    });
  } catch (error) {
    console.log("GET USER LEVELS ERROR", error.message);
    return res.status(error.statusCode || 500).json({
      message: error.message,
    });
  }
};

export const getFemaleUserLevelsAdmin = async (req, res) => {
  try {
    const data = await listFemaleUserLevels();
    return res.json(data);
  } catch (error) {
    console.log("GET FEMALE USER LEVELS ERROR", error.message);
    return res.status(error.statusCode || 500).json({
      message: error.message,
    });
  }
};

export const updateUserLevelsAdmin = async (req, res) => {
  try {
    const gender = normalizeUserLevelGender(req.body?.gender);

    if (!gender) {
      return res.status(400).json({
        message: "Body field gender must be male or female",
      });
    }

    const levels = await updateLevelConfig(gender, req.body?.levels || []);

    return res.json({
      message: "User level configuration updated",
      gender,
      levels,
    });
  } catch (error) {
    console.log("UPDATE USER LEVELS ERROR", error.message);
    return res.status(error.statusCode || 500).json({
      message: error.message,
    });
  }
};
