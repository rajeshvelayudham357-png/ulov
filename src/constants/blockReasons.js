export const BLOCK_REASON_KEYS = [
  "abusive_behavior",
  "inappropriate_content",
  "harassment",
  "spam_calls",
  "fake_profile",
  "rude_behavior",
  "other"
];

export const BLOCK_REASON_CATALOG = {
  abusive_behavior: { text: "Abusive behavior" },
  inappropriate_content: { text: "Inappropriate content" },
  harassment: { text: "Harassment" },
  spam_calls: { text: "Spam calls / messages" },
  fake_profile: { text: "Fake profile" },
  rude_behavior: { text: "Rude behavior" },
  other: { text: "Other" }
};

export const isValidBlockReason =
(reasonKey)=>
BLOCK_REASON_KEYS.includes(reasonKey);

export const getBlockReasonText =
(reasonKey)=>{
const item =
BLOCK_REASON_CATALOG[reasonKey];

return item?.text ?? reasonKey;
};
