import { getPublicAgoraConfig } from "../services/agoraSettings.service.js";

export const getPublicAgoraConfigHandler = async (req, res) => {
  try {
    const config = await getPublicAgoraConfig();
    return res.json(config);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
