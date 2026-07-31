import { getAppSettings } from "../services/appSettings.service.js";

export const getPublicAppSettings = async (req, res) => {
  try {
    const settings = await getAppSettings();
    return res.json(settings);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
