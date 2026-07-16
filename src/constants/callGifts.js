export const CALL_GIFTS = [
  {
    id: "heart_balloon",
    title: "Heart Balloon",
    coins: 49,
    emoji: "🎈",
  },
  {
    id: "sending_hugs",
    title: "Sending Hugs",
    coins: 99,
    emoji: "🤗",
  },
  {
    id: "roses_for_you",
    title: "Roses For You",
    coins: 199,
    emoji: "🌹",
  },
  {
    id: "i_like_you",
    title: "I Like You",
    coins: 499,
    emoji: "😍",
  },
];

export const FEMALE_GIFT_EARN_PERCENT = 25;

export const getCallGiftById = (giftId) =>
  CALL_GIFTS.find((gift) => gift.id === giftId) ?? null;
