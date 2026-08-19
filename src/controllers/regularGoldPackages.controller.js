import {
  getRegularGoldPackagesForAdmin,
  updateRegularGoldPackages,
} from "../services/regularGoldPackages.service.js";

export const getRegularGoldPackagesAdminConfig = async (req, res) => {
  try {
    const data = await getRegularGoldPackagesForAdmin();
    return res.json(data);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      message: error.message,
    });
  }
};

export const updateRegularGoldPackagesAdminConfig = async (req, res) => {
  try {
    const data = await updateRegularGoldPackages(req.body?.packs);

    return res.json({
      message: "Regular gold packages updated",
      ...data,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      message: error.message,
    });
  }
};
