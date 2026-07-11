export const RATING_LEVELS = [
  "very_bad",
  "bad",
  "average",
  "good",
  "very_good"
];

export const RATING_LABELS = {
  very_bad: "Very bad",
  bad: "Bad",
  average: "Average",
  good: "Good",
  very_good: "Very good"
};

export const VIDEO_REMARK_KEYS = [
  "face_not_showing",
  "improper_visuals",
  "abusive_talks",
  "poor_lighting",
  "camera_issue",
  "not_engaging",
  "background_noise"
];

export const AUDIO_REMARK_KEYS = [
  "audio_issue",
  "bad_talks",
  "abusive_talks",
  "voice_not_clear",
  "background_noise",
  "not_engaging",
  "call_dropped"
];

export const REMARK_CATALOG = {
  face_not_showing: { text: "Face not showing", types: ["video"] },
  improper_visuals: { text: "Improper visuals", types: ["video"] },
  abusive_talks: { text: "Abusive talks", types: ["audio", "video"] },
  poor_lighting: { text: "Poor lighting", types: ["video"] },
  camera_issue: { text: "Camera issue", types: ["video"] },
  not_engaging: { text: "Not engaging", types: ["audio", "video"] },
  background_noise: { text: "Background noise", types: ["audio", "video"] },
  audio_issue: { text: "Audio issue", types: ["audio"] },
  bad_talks: { text: "Bad talks", types: ["audio"] },
  voice_not_clear: { text: "Voice not clear", types: ["audio"] },
  call_dropped: { text: "Call dropped", types: ["audio"] }
};

export const isValidRating =
(rating)=>
RATING_LEVELS.includes(rating);

export const getRemarkText =
(key)=>{
const item =
REMARK_CATALOG[key];

return item?.text ?? key;
};

export const isAllowedRemarkKey =
(callType,key)=>{
if(!key || !REMARK_CATALOG[key]){
return false;
}

const normalized =
callType === "voice"
? "audio"
: callType;

const allowedTypes =
REMARK_CATALOG[key].types;

return allowedTypes.includes(normalized);
};

export const getRemarkKeysForCallType =
(callType)=>{
const normalized =
callType === "voice"
? "audio"
: callType;

return Object.keys(REMARK_CATALOG).filter(
(key)=>
REMARK_CATALOG[key].types.includes(normalized)
);
};
