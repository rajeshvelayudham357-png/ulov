export const MALE_MESSAGE_KEYS = [
  "hi",
  "good_morning",
  "good_night",
  "call_me",
  "attend_my_call",
  "which_time",
  "morning",
  "evening",
  "night",
  "miss_you",
  "are_you_free"
];

export const FEMALE_MESSAGE_KEYS = [
  "call_me_now",
  "ready_to_attend",
  "catch_you_later",
  "call_me_by_night",
  "good_morning",
  "good_night",
  "hi",
  "busy_now",
  "online_now",
  "thanks"
];

export const CHAT_MESSAGE_CATALOG = {
  hi: { text: "Hi 👋" },
  good_morning: { text: "Good morning ☀️" },
  good_night: { text: "Good night 🌙" },
  call_me: { text: "Call me 📞" },
  attend_my_call: { text: "Please attend my call" },
  which_time: { text: "Which time works for you?" },
  morning: { text: "Morning" },
  evening: { text: "Evening" },
  night: { text: "Night" },
  miss_you: { text: "Miss you 💕" },
  are_you_free: { text: "Are you free now?" },
  call_me_now: { text: "Call me now 📲" },
  ready_to_attend: { text: "Ready to attend your call" },
  catch_you_later: { text: "Will catch you later" },
  call_me_by_night: { text: "Call me by night 🌙" },
  busy_now: { text: "Busy right now" },
  online_now: { text: "I'm online now ✨" },
  thanks: { text: "Thanks 💖" }
};

export const getMessageText =
(key)=>{
const item =
CHAT_MESSAGE_CATALOG[key];

return item?.text ?? key;
};

export const isAllowedMessageKey =
(gender,key)=>{
if(!key || !CHAT_MESSAGE_CATALOG[key]){
return false;
}

const normalized =
String(gender ?? "")
.toLowerCase();

if(normalized === "male"){
return MALE_MESSAGE_KEYS.includes(key);
}

if(normalized === "female"){
return FEMALE_MESSAGE_KEYS.includes(key);
}

return false;
};
