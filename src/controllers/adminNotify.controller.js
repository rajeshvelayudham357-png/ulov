import { Op } from "sequelize";

import { AdminNotify, User } from "../models/index.js";
import { notifyUsersAdminMessage } from "../services/notificationPush.service.js";

const normalizeGender = (value) => {
  const gender = String(value || "").trim().toLowerCase();

  if (gender === "male") {
    return "Male";
  }

  if (gender === "female") {
    return "Female";
  }

  return null;
};

const resolveTargetUsers = async ({ mode, gender, userIds, search }) => {
  if (mode === "users") {
    const ids = [
      ...new Set(
        (Array.isArray(userIds) ? userIds : [])
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
      ),
    ];

    if (!ids.length) {
      return [];
    }

    const users = await User.findAll({
      where: {
        id: {
          [Op.in]: ids,
        },
      },
      attributes: ["id", "gender", "username", "name", "nickname"],
    });

    return users;
  }

  const normalizedGender = normalizeGender(gender);

  if (!normalizedGender) {
    throw new Error("Valid gender is required for bulk notify");
  }

  const where = {
    gender: {
      [Op.in]:
        normalizedGender === "Male"
          ? ["Male", "male"]
          : ["Female", "female"],
    },
  };

  const query = String(search || "").trim();

  if (query) {
    where[Op.and] = [
      {
        [Op.or]: [
          { name: { [Op.like]: `%${query}%` } },
          { nickname: { [Op.like]: `%${query}%` } },
          { username: { [Op.like]: `%${query}%` } },
          { publicUserId: { [Op.like]: `%${query}%` } },
          { phone: { [Op.like]: `%${query}%` } },
          { email: { [Op.like]: `%${query}%` } },
        ],
      },
    ];
  }

  return User.findAll({
    where,
    attributes: ["id", "gender", "username", "name", "nickname"],
  });
};

export const listNotifyUsers = async (req, res) => {
  try {
    const gender = normalizeGender(req.query.gender);
    const search = String(req.query.search || "").trim();

    if (!gender) {
      return res.status(400).json({
        message: "gender query must be Male or Female",
      });
    }

    const where = {
      gender: {
        [Op.in]:
          gender === "Male" ? ["Male", "male"] : ["Female", "female"],
      },
    };

    if (search) {
      where[Op.and] = [
        {
          [Op.or]: [
            { name: { [Op.like]: `%${search}%` } },
            { nickname: { [Op.like]: `%${search}%` } },
            { username: { [Op.like]: `%${search}%` } },
            { publicUserId: { [Op.like]: `%${search}%` } },
            { phone: { [Op.like]: `%${search}%` } },
            { email: { [Op.like]: `%${search}%` } },
          ],
        },
      ];
    }

    const users = await User.findAll({
      where,
      attributes: [
        "id",
        "publicUserId",
        "username",
        "name",
        "nickname",
        "phone",
        "email",
        "gender",
        "avatar",
        "online",
        "accountStatus",
        "createdAt",
      ],
      order: [["createdAt", "DESC"]],
      limit: 500,
    });

    return res.json(
      users.map((user) => {
        const data = user.toJSON();

        return {
          id: data.id,
          publicUserId: data.publicUserId,
          displayName:
            data.nickname || data.username || data.name || `User ${data.id}`,
          phone: data.phone,
          email: data.email,
          gender: data.gender,
          avatar: data.avatar,
          online: Boolean(data.online),
          accountStatus: data.accountStatus,
          createdAt: data.createdAt,
        };
      })
    );
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const sendAdminNotify = async (req, res) => {
  try {
    const {
      title,
      message,
      expiresAt,
      closable = true,
      mode = "gender",
      gender,
      userIds,
      search,
      compositionMode = "manual",
      templateKey = null,
      action = null,
      emoji = null,
    } = req.body || {};

    const cleanTitle = String(title || "").trim();
    const cleanMessage = String(message || "").trim();
    const cleanCompositionMode =
      compositionMode === "select" ? "select" : "manual";
    const cleanTemplateKey = templateKey
      ? String(templateKey).trim()
      : null;
    const cleanEmoji = emoji ? String(emoji).trim().slice(0, 16) : null;
    let cleanAction = null;

    if (
      action === "audio_verification" ||
      action === "video_verification" ||
      action === "otp_validation"
    ) {
      cleanAction = action;
    } else if (cleanTemplateKey === "otp_validation") {
      cleanAction = "otp_validation";
    }

    if (!cleanTitle || !cleanMessage) {
      return res.status(400).json({
        message: "Title and message are required",
      });
    }

    if (
      cleanCompositionMode === "select" &&
      cleanTemplateKey === "profile_verification" &&
      !cleanAction
    ) {
      return res.status(400).json({
        message:
          "Select audio or video verification for Profile Verification Alert",
      });
    }

    const targetMode = mode === "users" ? "users" : "gender";
    const users = await resolveTargetUsers({
      mode: targetMode,
      gender,
      userIds,
      search,
    });

    if (!users.length) {
      return res.status(404).json({
        message: "No matching users found to notify",
      });
    }

    const isClosable = closable !== false;
    let parsedExpiresAt = null;

    if (expiresAt) {
      const date = new Date(expiresAt);

      if (Number.isNaN(date.getTime())) {
        return res.status(400).json({
          message: "Invalid expiry date",
        });
      }

      parsedExpiresAt = date;
    }

    if (!isClosable && !parsedExpiresAt) {
      return res.status(400).json({
        message: "Expiry date is required for non-closable notifications",
      });
    }
    const ids = users.map((user) => Number(user.id));

    const record = await AdminNotify.create({
      title: cleanTitle,
      message: cleanMessage,
      expiresAt: parsedExpiresAt,
      closable: isClosable,
      targetType: targetMode === "users" ? "user" : "gender",
      targetGender:
        targetMode === "gender" ? normalizeGender(gender) : null,
      targetUserIds: targetMode === "users" ? ids : null,
      notifiedCount: 0,
      createdByAdminId: req.admin?.id || null,
      templateKey: cleanTemplateKey,
      action: cleanAction,
      compositionMode: cleanCompositionMode,
      emoji: cleanEmoji,
    });

    const result = await notifyUsersAdminMessage({
      userIds: ids,
      title: cleanTitle,
      message: cleanMessage,
      expiresAt: parsedExpiresAt,
      closable: isClosable,
      adminNotifyId: record.id,
      templateKey: cleanTemplateKey,
      action: cleanAction,
      compositionMode: cleanCompositionMode,
      emoji: cleanEmoji,
    });

    await record.update({
      notifiedCount: result.notified,
    });

    return res.json({
      message: "Notification sent",
      notify: {
        id: record.id,
        title: record.title,
        message: record.message,
        expiresAt: record.expiresAt,
        closable: record.closable,
        targetType: record.targetType,
        targetGender: record.targetGender,
        notifiedCount: result.notified,
        pushSent: result.pushSent,
        createdAt: record.createdAt,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const listAdminNotifyHistory = async (req, res) => {
  try {
    const rows = await AdminNotify.findAll({
      order: [["createdAt", "DESC"]],
      limit: 100,
    });

    return res.json(
      rows.map((row) => {
        const data = row.toJSON();

        return {
          id: data.id,
          title: data.title,
          message: data.message,
          expiresAt: data.expiresAt,
          closable: data.closable,
          targetType: data.targetType,
          targetGender: data.targetGender,
          targetUserIds: data.targetUserIds,
          notifiedCount: data.notifiedCount,
          templateKey: data.templateKey,
          action: data.action,
          compositionMode: data.compositionMode,
          createdAt: data.createdAt,
        };
      })
    );
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};
